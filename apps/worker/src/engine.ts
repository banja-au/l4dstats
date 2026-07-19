import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquire, extractEntry, inspectZip } from "@l4dstats/acquisition";
import {
  type CasePresentationV1,
  ContentAddressedStore,
  sha256,
  type Job,
  type ReviewStatus,
  type WorkbenchRepository,
} from "@l4dstats/storage";
import type { JobHandler } from "./worker.js";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 5 * 60 * 1000;
const TERMINATION_GRACE_MS = 1_000;
const MAX_OLD_SPACE_MIB = 4_096;
const MAX_ADDRESS_SPACE_BYTES = 5 * 1024 * 1024 * 1024;
const REMOTE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
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
  demo: {
    parser?: ParserAttestation;
    sha256: string;
    mapName: string;
    bytes: number;
    session?: {
      serverToken: string | null;
      rosterToken: string | null;
      serverCount: number | null;
      campaign: string | null;
      chapter: number | null;
      evidence: string[];
    };
    stats?: unknown;
  };
  cases: EngineCaseResult[];
}

interface ParserAttestation {
  engine: "rust-native";
  coreVersion: string;
  bindingVersion: string | null;
  bindingApiVersion: number | null;
  configVersion: number;
  wireVersion: number;
  parserConfigId: string;
  buildSha256: string | null;
}

export function validateNativeParserAttestation(
  result: EngineAnalysisResult,
): void {
  const parser = result.demo.parser;
  if (
    !parser ||
    parser.engine !== "rust-native" ||
    !/^\d+\.\d+\.\d+/.test(parser.coreVersion) ||
    typeof parser.bindingVersion !== "string" ||
    !/^\d+\.\d+\.\d+/.test(parser.bindingVersion) ||
    parser.bindingApiVersion !== 2 ||
    parser.configVersion !== 1 ||
    parser.wireVersion !== 1 ||
    parser.parserConfigId !== "source1-l4d2-2100-v1" ||
    typeof parser.buildSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(parser.buildSha256) ||
    /^0{64}$/.test(parser.buildSha256)
  )
    throw new Error("Engine returned invalid native parser attestation");
  const expected = `demo-source1-native@${parser.coreVersion}+node-${parser.bindingVersion}/config-${parser.configVersion}/build-${parser.buildSha256}`;
  if (result.cases.some((item) => item.versions.parser !== expected))
    throw new Error("Case parser lineage does not match demo attestation");
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
  processLimits?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    terminationGraceMs?: number;
  };
  analyze?: (
    demo: PreparedDemo,
    context: { isCancelled(): boolean },
  ) => Promise<EngineAnalysisResult>;
}

export function engineCommand(
  path: string,
  production = process.env.NODE_ENV === "production",
): {
  command: string;
  args: string[];
} {
  const entrypoint = production
    ? ["apps/cli/dist/main.js"]
    : [
        "--import",
        createRequire(import.meta.url).resolve("tsx"),
        "apps/cli/src/main.ts",
      ];
  const nodeArgs = [
    `--max-old-space-size=${MAX_OLD_SPACE_MIB}`,
    ...(production && process.platform === "linux"
      ? [
          "--permission",
          "--allow-addons",
          `--allow-fs-read=${REPOSITORY_ROOT}`,
          `--allow-fs-read=${resolve(path)}`,
        ]
      : []),
    ...entrypoint,
    "evidence-bundle",
    path,
  ];
  // Development's tsx loader and source graph reserve enough virtual address
  // space to make RLIMIT_AS unreliable. Production executes compiled JavaScript
  // with the native addon inside the stricter OS limits below.
  if (production && process.platform === "linux") {
    const sandbox =
      process.env.L4DSTATS_PARSER_SANDBOX ??
      resolve(REPOSITORY_ROOT, "apps/worker/dist/parser-no-network");
    if (!existsSync(sandbox))
      throw new Error(`Production parser sandbox is unavailable: ${sandbox}`);
    const sandboxed = [sandbox, process.execPath, ...nodeArgs];
    if (!existsSync("/usr/bin/prlimit"))
      return { command: sandboxed[0]!, args: sandboxed.slice(1) };
    return {
      command: "/usr/bin/prlimit",
      args: [
        `--as=${MAX_ADDRESS_SPACE_BYTES}`,
        "--cpu=300",
        "--nofile=64:64",
        "--core=0:0",
        "--",
        ...sandboxed,
      ],
    };
  }
  return { command: process.execPath, args: nodeArgs };
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
        ...(job.source.sourceObjectSha256
          ? {
              sourceObjectSha256: job.source.sourceObjectSha256,
              sourceObjectBytes: job.source.sourceObjectBytes,
              sourceObjectFormat: job.source.sourceObjectFormat,
            }
          : {}),
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
  context: {
    isCancelled(): boolean;
    progress(value: number, message: string): void;
  },
  commandForDemo: EngineDependencies["commandForDemo"] = engineCommand,
  pseudonymKey = "l4dstats-dev-only-local-key-v1",
  limits: NonNullable<EngineDependencies["processLimits"]> = {},
): Promise<EngineAnalysisResult> {
  const invocation = commandForDemo(demo.path);
  const timeoutMs = limits.timeoutMs ?? TIMEOUT_MS;
  const maxOutputBytes = limits.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const terminationGraceMs = limits.terminationGraceMs ?? TERMINATION_GRACE_MS;
  const inspection = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      const childEnvironment = Object.fromEntries(
        ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ"]
          .map((key) => [key, process.env[key]])
          .filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      const child = spawn(invocation.command, invocation.args, {
        cwd: REPOSITORY_ROOT,
        env: {
          ...childEnvironment,
          CI: "true",
          ...(process.env.NODE_ENV === "production"
            ? {
                NODE_ENV: "production",
                NODE_OPTIONS: "--conditions=production",
              }
            : {}),
          L4DSTATS_PSEUDONYM_KEY: pseudonymKey,
        },
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let stderrBuffer = "";
      let reportedProgress = 0.2;
      let phaseCeiling = 0.223;
      let phaseMessage = "Reading SourceTV demo stream";
      let outputBytes = 0,
        settled = false,
        terminalError: Error | undefined,
        forceKill: NodeJS.Timeout | undefined;
      const finish = (error?: Error, value?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(cancellation);
        clearInterval(heartbeat);
        if (forceKill) clearTimeout(forceKill);
        if (error) reject(error);
        else resolve(value!);
      };
      const signalChild = (signal: NodeJS.Signals) => {
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          child.kill(signal);
        }
      };
      const terminate = (error: Error) => {
        if (terminalError) return;
        terminalError = error;
        clearTimeout(timeout);
        clearInterval(cancellation);
        clearInterval(heartbeat);
        child.stdout.pause();
        child.stderr.pause();
        signalChild("SIGTERM");
        forceKill = setTimeout(
          () => signalChild("SIGKILL"),
          terminationGraceMs,
        );
      };
      const timeout = setTimeout(() => {
        terminate(new Error("Engine exceeded the local job time limit"));
      }, timeoutMs);
      const cancellation = setInterval(() => {
        if (context.isCancelled()) {
          terminate(new Error("Engine cancelled by reviewer"));
        }
      }, 50);
      const heartbeat = setInterval(() => {
        if (reportedProgress >= phaseCeiling) return;
        reportedProgress = Math.min(phaseCeiling, reportedProgress + 0.008);
        context.progress(reportedProgress, phaseMessage);
      }, 650);
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          terminate(new Error("Engine output exceeded the configured limit"));
        } else chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          terminate(new Error("Engine output exceeded the configured limit"));
          return;
        }
        stderrBuffer += chunk.toString("utf8");
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("L4DSTATS_PROGRESS ")) continue;
          try {
            const update = JSON.parse(line.slice(20)) as {
              progress: number;
              message: string;
            };
            const mapped =
              0.2 + Math.max(0, Math.min(1, update.progress)) * 0.7;
            const nextMilestone = [
              0.14, 0.25, 0.62, 0.7, 0.78, 0.86, 0.96, 1,
            ].find((value) => value > update.progress)!;
            reportedProgress = Math.max(reportedProgress, mapped);
            phaseCeiling = Math.min(0.9, 0.2 + nextMilestone * 0.7 - 0.005);
            phaseMessage = update.message;
            context.progress(reportedProgress, phaseMessage);
          } catch {
            // Progress telemetry is advisory and must never fail analysis.
          }
        }
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (terminalError) {
          finish(terminalError);
          return;
        }
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
  validateNativeParserAttestation(result);
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
      context.progress(0.2, "Reading SourceTV demo stream");
      const result = dependencies.analyze
        ? await dependencies.analyze(prepared, {
            isCancelled: context.isCancelled,
          })
        : await analyzeWithCli(
            prepared,
            {
              isCancelled: context.isCancelled,
              progress: context.progress,
            },
            dependencies.commandForDemo,
            dependencies.pseudonymKey,
            dependencies.processLimits,
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
