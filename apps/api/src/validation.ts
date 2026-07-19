import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { IngestSource } from "@l4dstats/storage";

export interface IngestionPolicy {
  allowedHosts: readonly string[];
  allowedLocalRoots: readonly string[];
  maxLocalBytes: number;
}

export async function validateSource(
  input: unknown,
  policy: IngestionPolicy,
): Promise<IngestSource> {
  if (!input || typeof input !== "object")
    throw new Error("source must be an object");
  const value = input as Record<string, unknown>;
  if (value.kind === "remote") {
    if (typeof value.url !== "string")
      throw new Error("remote source requires a URL");
    const url = new URL(value.url);
    if (url.protocol !== "https:")
      throw new Error("remote source must use HTTPS");
    if (
      !policy.allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      throw new Error("remote host is not allowlisted");
    if (url.username || url.password || url.port)
      throw new Error("remote URL credentials and ports are forbidden");
    return { kind: "remote", url: url.href };
  }
  if (value.kind === "local") {
    if (typeof value.path !== "string" || !isAbsolute(value.path))
      throw new Error("local source requires an absolute path");
    const path = await realpath(value.path),
      allowed = await Promise.all(
        policy.allowedLocalRoots.map((root) => realpath(root)),
      );
    if (
      !allowed.some((root) => {
        const rel = relative(root, path);
        return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      })
    )
      throw new Error("local path is outside allowed roots");
    if (extname(path).toLowerCase() !== ".dem")
      throw new Error("local source must be a .dem file");
    const info = await stat(path);
    if (!info.isFile() || info.size > policy.maxLocalBytes)
      throw new Error("local source is not a bounded regular file");
    const hash = createHash("sha256"),
      file = await open(path, "r");
    try {
      for await (const chunk of file.createReadStream())
        hash.update(chunk as Buffer);
    } finally {
      await file.close();
    }
    return {
      kind: "local",
      path: resolve(path),
      sha256: hash.digest("hex"),
      bytes: info.size,
    };
  }
  throw new Error("source kind must be local or remote");
}
