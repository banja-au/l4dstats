import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  HostedObjectStore,
  HostedSource,
  ObjectMetadata,
} from "@l4dstats/storage";

export interface MaterializedHostedSource {
  path: string;
  sha256: string;
  bytes: number;
  object: ObjectMetadata;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeFilename(value: string): string {
  const name = basename(value);
  if (!name.toLowerCase().endsWith(".dem"))
    throw new Error("hosted source filename must end in .dem");
  return `${randomUUID()}.dem`;
}

/**
 * Materialize one private object into bounded ephemeral storage, verify it
 * independently, and delete both remote and local source bytes before success.
 * The callback must complete all durable derived writes before returning.
 */
export async function processEphemeralHostedSource<T>(input: {
  source: HostedSource;
  store: HostedObjectStore;
  workRoot: string;
  maxBytes: number;
  process(source: MaterializedHostedSource): Promise<T>;
}): Promise<T> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1)
    throw new Error("hosted source maximum byte size is invalid");
  const workRoot = resolve(input.workRoot);
  const workDirectory = join(workRoot, randomUUID());
  await mkdir(workDirectory, { recursive: false });
  const path = join(workDirectory, safeFilename(input.source.filename));
  try {
    const object = await input.store.head(input.source.key);
    if (!object) throw new Error("hosted source object is unavailable");
    if (
      object.bytes !== input.source.bytes ||
      object.sha256 !== input.source.sha256
    )
      throw new Error("hosted source metadata does not match the queued job");
    if (object.bytes > input.maxBytes)
      throw new Error("hosted source exceeds the parser byte limit");
    const bytes = await input.store.get(input.source.key);
    if (bytes.byteLength !== object.bytes)
      throw new Error("hosted source download is incomplete");
    const digest = sha256(bytes);
    if (digest !== input.source.sha256)
      throw new Error("hosted source SHA-256 does not match the queued job");
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    const result = await input.process({
      path,
      sha256: digest,
      bytes: bytes.byteLength,
      object,
    });
    await input.store.delete(input.source.key);
    return result;
  } catch (error) {
    // Failed and cancelled jobs do not retain identity-bearing source bytes.
    // Lifecycle expiry remains the backstop if the provider delete also fails.
    await input.store.delete(input.source.key).catch(() => undefined);
    throw error;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
