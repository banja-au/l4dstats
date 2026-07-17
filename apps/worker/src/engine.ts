import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { acquire, extractEntry, inspectZip } from "@witchwatch/acquisition";
import {
  type CasePresentationV1,
  ContentAddressedStore,
  sha256,
  type Job,
  type ReviewStatus,
  type WorkbenchRepository,
} from "@witchwatch/storage";
import type { JobHandler } from "./worker.js";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 5 * 60 * 1000;
const REMOTE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const ZIP_LIMITS = {
  maxEntries: 64,
  maxExpandedBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
} as const;

export interface EngineCaseResult {
  id: string;
  playerKey: string;
  status: ReviewStatus;
  score: unknown;
  evidence: unknown[];
  windows: { startTick: number; endTick: number; payload: unknown }[];
  versions: {
    parser: string;
    schema: string;
    detectors: string[];
    model: string;
  };
  config: unknown;
  map: { name: string; assetVersion: string };
  derivation: string[];
  limitations: string[];
  presentation: CasePresentationV1;
}

export interface EngineAnalysisResult {
  schemaVersion: 1;
  demo: { sha256: string; mapName: string; bytes: number };
  cases: EngineCaseResult[];
}

interface PreparedDemo {
  path: string;
  sha256: string;
  bytes: number;
  sourceManifest: unknown;
}

export interface EngineDependencies {
  artifactRoot: string;
  allowedHosts: readonly string[];
  pseudonymKey?: string;
  acquireRemote?: typeof acquire;
  /** Test/embedded transport hook; production defaults to global fetch. */
  remoteFetch?: typeof globalThis.fetch;
  commandForDemo?: (path: string) => { command: string; args: string[] };
  analyze?: (
    demo: PreparedDemo,
    context: { isCancelled(): boolean },
  ) => Promise<EngineAnalysisResult>;
}

export function engineCommand(path: string): {
  command: string;
  args: string[];
} {
  return {
    command: "pnpm",
    args: ["--filter", "@witchwatch/cli", "dev", "evidence-bundle", path],
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`;
}

async function prepareDemo(
  job: Job,
  dependencies: EngineDependencies,
  signal: AbortSignal,
): Promise<PreparedDemo> {
  const store = new ContentAddressedStore(dependencies.artifactRoot);
  if (job.source.kind === "local") {
    const bytes = await readFile(job.source.path);
    if (sha256(bytes) !== job.source.sha256)
      throw new Error("Local demo changed after validation");
    const artifact = await store.put(bytes);
    return {
      path: store.path(artifact.sha256),
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      sourceManifest: {
        kind: "local",
        origin: "validated-local-file",
        sha256: artifact.sha256,
        bytes: artifact.bytes,
      },
    };
  }
  const url = new URL(job.source.url);
  if (
    !dependencies.allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new Error("Remote job host is not allowlisted by this worker");
  const manifest = await (dependencies.acquireRemote ?? acquire)(url, {
    allowedHosts: [url.hostname],
    store: dependencies.artifactRoot,
    maxBytes: REMOTE_MAX_BYTES,
    timeoutMs: 30_000,
    signal,
    ...(dependencies.remoteFetch ? { fetch: dependencies.remoteFetch } : {}),
  });
  const archive = await readFile(manifest.artifactPath);
  let demoBytes: Buffer;
  if (extname(url.pathname).toLowerCase() === ".dem") demoBytes = archive;
  else {
    const demos = inspectZip(archive, ZIP_LIMITS).filter((entry) =>
      entry.name.toLowerCase().endsWith(".dem"),
    );
    if (demos.length !== 1)
      throw new Error(
        `Remote archive must contain exactly one .dem entry; found ${demos.length}`,
      );
    demoBytes = extractEntry(archive, demos[0]!, ZIP_LIMITS);
  }
  const artifact = await store.put(demoBytes);
  return {
    path: store.path(artifact.sha256),
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    sourceManifest: {
      kind: "remote",
      sourceUrl: sanitizeUrl(manifest.sourceUrl),
      finalUrl: sanitizeUrl(manifest.finalUrl),
      archiveSha256: manifest.sha256,
      archiveBytes: manifest.bytes,
      demoSha256: artifact.sha256,
      demoBytes: artifact.bytes,
      acquisitionSchemaVersion: manifest.schemaVersion,
    },
  };
}

function sanitizeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Run the versioned CLI boundary without a shell, cancelling the child promptly. */
async function analyzeWithCli(
  demo: PreparedDemo,
  context: { isCancelled(): boolean },
  commandForDemo: EngineDependencies["commandForDemo"] = engineCommand,
  pseudonymKey = "witchwatch-dev-only-local-key-v1",
): Promise<EngineAnalysisResult> {
  const invocation = commandForDemo(demo.path);
  const inspection = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: "/workspace",
        env: {
          ...process.env,
          CI: "true",
          WITCHWATCH_PSEUDONYM_KEY: pseudonymKey,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let outputBytes = 0,
        settled = false;
      const finish = (error?: Error, value?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(cancellation);
        if (error) reject(error);
        else resolve(value!);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("Engine exceeded the five-minute local job limit"));
      }, TIMEOUT_MS);
      const cancellation = setInterval(() => {
        if (context.isCancelled()) {
          child.kill("SIGTERM");
          finish(new Error("Engine cancelled by reviewer"));
        }
      }, 50);
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGTERM");
          finish(new Error("Engine output exceeded the 16-megabyte limit"));
        } else chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGTERM");
          finish(new Error("Engine output exceeded the 16-megabyte limit"));
        }
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (code !== 0)
          finish(new Error(`Engine exited with status ${code ?? "signal"}`));
        else {
          try {
            finish(
              undefined,
              JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
                string,
                unknown
              >,
            );
          } catch {
            finish(new Error("Engine returned invalid JSON"));
          }
        }
      });
    },
  );
  const result = inspection as unknown as EngineAnalysisResult;
  if (result.schemaVersion !== 1 || !Array.isArray(result.cases))
    throw new Error("Engine returned an invalid evidence bundle");
  return result;
}

async function persistAnalysis(
  repo: WorkbenchRepository,
  job: Job,
  prepared: PreparedDemo,
  result: EngineAnalysisResult,
  artifactRoot: string,
): Promise<void> {
  if (result.demo.sha256 !== prepared.sha256)
    throw new Error("Engine result demo hash does not match acquired artifact");
  const serializedResult = canonical(result);
  const resultArtifact = await new ContentAddressedStore(artifactRoot).put(
    new TextEncoder().encode(serializedResult),
  );
  const engineResultSha256 = resultArtifact.sha256;
  const sourceLineage = {
    source: prepared.sourceManifest,
    artifacts: { demoSha256: prepared.sha256, engineResultSha256 },
    versions: null as unknown,
    config: null as unknown,
    map: null as unknown,
    derivation: [] as string[],
    limitations: [] as string[],
  };
  repo.db.exec("BEGIN IMMEDIATE");
  try {
    repo.recordJobAnalysis({
      jobId: job.id,
      demoSha256: prepared.sha256,
      sourceManifest: prepared.sourceManifest,
      engineResult: result,
      engineResultSha256,
    });
    for (const item of result.cases) {
      const existing = repo.getCase(item.id);
      const existingPresentation = existing
        ? repo.getCasePresentation(item.id)
        : undefined;
      const presentation = mergePresentation(
        existingPresentation,
        item.presentation,
        prepared.sourceManifest,
      );
      const existingScore = existing
        ? (JSON.parse(existing.scoreJson) as Record<string, unknown> & {
            evidence?: unknown[];
            status?: string;
          })
        : undefined;
      const existingEvidence = existingScore?.evidence ?? [];
      const incomingScore = (item.score ?? {}) as Record<string, unknown>;
      const retainedScore =
        existingScore?.status === "ranked-evidence" &&
        incomingScore.status === "insufficient-data"
          ? existingScore
          : incomingScore;
      repo.upsertCase({
        id: item.id,
        playerKey: item.playerKey,
        status: existing?.status ?? item.status,
        score: {
          ...retainedScore,
          evidence: [...existingEvidence, ...item.evidence],
          independentEvidence: {
            demos: presentation.demos.length,
            signalFamilies: presentation.summary.independentSignalFamilies,
            encounters: presentation.summary.encounterCount,
          },
        },
      });
      for (const window of item.windows)
        repo.putWindow(
          item.id,
          window.startTick,
          window.endTick,
          window.payload,
          prepared.sha256,
        );
      sourceLineage.versions = item.versions;
      sourceLineage.config = item.config;
      sourceLineage.map = item.map;
      sourceLineage.derivation = item.derivation;
      sourceLineage.limitations = item.limitations;
      const previousLineage = existing
        ? (repo.getCaseLineage(item.id) as { sources?: unknown[] })
        : undefined;
      repo.setCaseLineage(item.id, {
        schemaVersion: 1,
        sources: [...(previousLineage?.sources ?? []), { ...sourceLineage }],
      });
      repo.setCasePresentation(item.id, presentation);
    }
    repo.db.exec("COMMIT");
  } catch (error) {
    repo.db.exec("ROLLBACK");
    throw error;
  }
}

function mergePresentation(
  existing: CasePresentationV1 | undefined,
  incoming: CasePresentationV1,
  sourceManifest: unknown,
): CasePresentationV1 {
  const sourceLabel =
    sourceManifest &&
    typeof sourceManifest === "object" &&
    (sourceManifest as { kind?: string }).kind === "remote"
      ? "allowlisted remote acquisition"
      : "validated local demo";
  const normalized = {
    ...incoming,
    demos: incoming.demos.map((demo) => ({ ...demo, sourceLabel })),
  };
  if (!existing) return normalized;
  if (
    existing.association.kind !== "stable-privacy-token" ||
    normalized.association.kind !== "stable-privacy-token" ||
    existing.association.stableToken !== normalized.association.stableToken
  )
    throw new Error("case collision without a matching privacy-stable token");
  const demos = uniqueBy(
    [...existing.demos, ...normalized.demos],
    (demo) => demo.sha256,
  ).map((demo) => ({ ...demo, corroboration: "same-stable-player" as const }));
  const evidence = uniqueBy(
    [...existing.evidence, ...normalized.evidence],
    (item) => `${item.demoSha256}:${item.id}`,
  );
  return {
    ...normalized,
    demos,
    evidence,
    association: {
      kind: "stable-privacy-token",
      stableToken: normalized.association.stableToken,
      corroboratingDemoCount: Math.max(0, demos.length - 1),
      explanation:
        "Independently ingested demos share the same keyed-HMAC privacy token; raw identity is not stored.",
    },
    summary: {
      encounterCount: evidence.length,
      independentSignalFamilies: [
        ...new Set(evidence.map(({ family }) => family)),
      ],
    },
  };
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

export function createEngineJobHandler(
  repo: WorkbenchRepository,
  dependencies: EngineDependencies,
): JobHandler {
  return async (job, context) => {
    const abort = new AbortController();
    const cancelWatch = setInterval(() => {
      if (context.isCancelled()) abort.abort();
    }, 50);
    try {
      context.progress(0.05, "Acquiring content-addressed demo artifact");
      const prepared = await prepareDemo(job, dependencies, abort.signal);
      if (context.isCancelled()) return;
      context.progress(0.2, "Running versioned evidence engine");
      const result = dependencies.analyze
        ? await dependencies.analyze(prepared, {
            isCancelled: context.isCancelled,
          })
        : await analyzeWithCli(
            prepared,
            { isCancelled: context.isCancelled },
            dependencies.commandForDemo,
            dependencies.pseudonymKey,
          );
      if (context.isCancelled()) return;
      await persistAnalysis(
        repo,
        job,
        prepared,
        result,
        dependencies.artifactRoot,
      );
      context.progress(0.95, "Analysis and derivation lineage persisted");
    } finally {
      clearInterval(cancelWatch);
    }
  };
}
