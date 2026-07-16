import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { boundedFetch, type DiscoveryOptions } from "./discovery.js";
import { AcquisitionError } from "./errors.js";

export interface DownloadOptions extends DiscoveryOptions {
  store: string;
  maxBytes: number;
}
export interface AcquisitionManifest {
  schemaVersion: 1;
  sourceUrl: string;
  finalUrl: string;
  sha256: string;
  bytes: number;
  artifactPath: string;
  acquiredAt: string;
  cache: "content-addressed";
  resume: "atomic-restart";
}

/** Downloads to a private temporary file, then atomically publishes by digest. Partial data is never resumed. */
export async function acquire(
  url: URL,
  options: DownloadOptions,
): Promise<AcquisitionManifest> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const operationSignal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const response = await boundedFetch(url, {
    ...options,
    signal: operationSignal,
  });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes)
    throw new AcquisitionError("DOWNLOAD_LIMIT", "declared size exceeds limit");
  if (!response.body)
    throw new AcquisitionError("HTTP", "response has no body");
  await mkdir(options.store, { recursive: true });
  const temporary = join(options.store, `.partial-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    try {
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > options.maxBytes)
          throw new AcquisitionError(
            "DOWNLOAD_LIMIT",
            "download exceeds byte limit",
          );
        hash.update(chunk);
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (operationSignal.aborted)
      throw new AcquisitionError(
        options.signal?.aborted ? "ABORTED" : "TIMEOUT",
        "download aborted",
        { cause: error },
      );
    throw error;
  }
  const sha256 = hash.digest("hex");
  const artifactPath = join(
    options.store,
    "sha256",
    sha256.slice(0, 2),
    sha256,
  );
  await mkdir(dirname(artifactPath), { recursive: true });
  try {
    await copyFile(temporary, artifactPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return {
    schemaVersion: 1,
    sourceUrl: url.href,
    finalUrl: response.url || url.href,
    sha256,
    bytes,
    artifactPath,
    acquiredAt: new Date().toISOString(),
    cache: "content-addressed",
    resume: "atomic-restart",
  };
}
