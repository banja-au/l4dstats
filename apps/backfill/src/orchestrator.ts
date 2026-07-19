import { readFile } from "node:fs/promises";
import { acquire, prepareUploadedDemo } from "@l4dstats/acquisition";
import { ContentAddressedStore } from "@l4dstats/storage";
import { analyzeLocalDemo } from "@l4dstats/worker";
import { BackfillState } from "./state.js";
import type { Publisher } from "./publisher.js";
import type { PendingDemo, SourceAdapter } from "./types.js";

const SOURCE_LIMIT = 100 * 1024 * 1024;
const DEMO_LIMIT = 512 * 1024 * 1024;
const DEMO_LIMITS = {
  maxSourceBytes: SOURCE_LIMIT,
  maxDemoBytes: DEMO_LIMIT,
  maxCompressionRatio: 200,
  maxZipEntries: 16,
  timeoutMs: 30_000,
} as const;

export interface BackfillSummary {
  discovered: number;
  selected: number;
  completed: number;
  failed: number;
  gameIds: string[];
}

function permanent(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unsupported|unsafe path|does not match|not a Source demo|compression ratio|byte limit|invalid.*response|invalid entries/i.test(
    message,
  );
}

async function parallel<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item) await task(item);
      }
    }),
  );
}

export async function runBackfill(input: {
  state: BackfillState;
  source: SourceAdapter;
  publisher: Publisher;
  objectRoot: string;
  pseudonymKey: string;
  concurrency: number;
  maxDemos: number;
  log?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<BackfillSummary> {
  const log = input.log ?? console.log;
  const discoveryStarted = Date.now();
  log(`starting discovery: source=${input.source.id}`);
  const discoveryHeartbeat = setInterval(
    () =>
      log(
        `discovery still running: source=${input.source.id}, elapsed=${Math.round((Date.now() - discoveryStarted) / 1_000)}s`,
      ),
    5_000,
  );
  input.state.beginDiscovery(input.source.id);
  let discovered;
  try {
    discovered = await input.source.discover(input.signal);
    clearInterval(discoveryHeartbeat);
    log(
      `checkpointing ${discovered.length} catalog entries locally (discovery only; demos are not processed yet)`,
    );
    input.state.upsertDiscovered(discovered);
    const highest = discovered.reduce<string | null>(
      (value, item) =>
        value === null || item.publishedAt > value ? item.publishedAt : value,
      null,
    );
    input.state.completeDiscovery(input.source.id, highest);
    log(
      `discovery complete: source=${input.source.id}, elapsed=${((Date.now() - discoveryStarted) / 1_000).toFixed(1)}s`,
    );
  } catch (error) {
    clearInterval(discoveryHeartbeat);
    input.state.failDiscovery(
      input.source.id,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  const selected = input.state.pending(input.maxDemos);
  log(
    `catalog checkpoint complete; selected ${selected.length} demos for local download and Rust processing`,
  );
  let completed = 0;
  let failed = 0;
  const gameIds = new Set<string>();
  const store = new ContentAddressedStore(input.objectRoot);
  const activeObjects = new Map<string, number>();
  const retain = (hash: string) =>
    activeObjects.set(hash, (activeObjects.get(hash) ?? 0) + 1);
  const release = async (hash: string | undefined) => {
    if (!hash) return;
    const remaining = (activeObjects.get(hash) ?? 1) - 1;
    if (remaining > 0) {
      activeObjects.set(hash, remaining);
      return;
    }
    activeObjects.delete(hash);
    const deleted = await store.delete(hash);
    log(
      `local object cleanup: sha256=${hash}, deleted=${deleted ? "yes" : "already absent"}`,
    );
  };
  const grouped = new Map<string, PendingDemo[]>();
  for (const item of selected) {
    const key = item.gameHint
      ? `${item.sourceId}:${item.gameHint}`
      : `${item.sourceId}:${item.sourceItemKey}`;
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  await parallel([...grouped.values()], input.concurrency, async (group) => {
    for (const item of group) {
      if (input.signal?.aborted) return;
      let sourceHash: string | undefined;
      let demoHash: string | undefined;
      input.state.start(item);
      try {
        log(
          `[${item.gameHint ?? "unassociated"}] downloading ${item.filename}`,
        );
        const manifest = await acquire(new URL(item.downloadUrl), {
          allowedHosts: ["demosdl.l4d2center.com"],
          store: input.objectRoot,
          maxBytes: SOURCE_LIMIT,
          timeoutMs: 30_000,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        sourceHash = manifest.sha256;
        retain(sourceHash);
        log(
          `[${item.gameHint ?? "unassociated"}] source acquired: bytes=${manifest.bytes}, sha256=${manifest.sha256}`,
        );
        input.state.recordSource(item, manifest.sha256, manifest.bytes);
        const sourceBytes = await readFile(manifest.artifactPath);
        const prepared = await prepareUploadedDemo(
          item.filename,
          sourceBytes,
          DEMO_LIMITS,
        );
        log(
          `[${item.gameHint ?? "unassociated"}] expanded: format=${prepared.sourceFormat}, bytes=${prepared.bytes.byteLength}, demoSha256=${prepared.sha256}`,
        );
        const demoArtifact = await store.put(prepared.bytes);
        demoHash = demoArtifact.sha256;
        retain(demoHash);
        input.state.recordDemo(item, demoArtifact.sha256, demoArtifact.bytes);
        log(`[${item.gameHint ?? "unassociated"}] processing ${item.filename}`);
        const analysis = await analyzeLocalDemo({
          path: store.path(demoArtifact.sha256),
          sha256: demoArtifact.sha256,
          bytes: demoArtifact.bytes,
          pseudonymKey: input.pseudonymKey,
          isCancelled: () => input.signal?.aborted ?? false,
          progress: (value, message) =>
            log(
              `[${item.gameHint ?? "unassociated"}] parser ${Math.round(value * 100)}%: ${message}`,
            ),
        });
        log(
          `[${item.gameHint ?? "unassociated"}] parser complete: map=${analysis.result.demo.mapName}, cases=${analysis.result.cases.length}, resultBytes=${analysis.serialized.byteLength}`,
        );
        const published = await input.publisher.publish({
          item,
          sourceSha256: manifest.sha256,
          sourceBytes: manifest.bytes,
          demoSha256: demoArtifact.sha256,
          result: analysis.result,
          serialized: analysis.serialized,
        });
        input.state.complete(item, published);
        gameIds.add(published.gameId);
        completed += 1;
        log(`[${item.gameHint ?? "unassociated"}] complete ${item.filename}`);
      } catch (error) {
        failed += 1;
        const detail = error instanceof Error ? error.message : String(error);
        input.state.fail(
          item,
          permanent(error) ? "permanent_failure" : "retryable_failure",
          "PROCESSING_FAILED",
          detail,
        );
        log(
          `[${item.gameHint ?? "unassociated"}] failed ${item.filename}: ${detail}`,
        );
      } finally {
        await release(demoHash);
        await release(sourceHash);
      }
    }
  });
  return {
    discovered: discovered.length,
    selected: selected.length,
    completed,
    failed,
    gameIds: [...gameIds].sort(),
  };
}
