import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { gunzipSync, zstdDecompressSync } from "node:zlib";
import { extractEntry, inspectZip, type ZipLimits } from "./zip.js";

export const supportedDemoExtensions = [
  ".dem",
  ".zip",
  ".dem.zip",
  ".dem.gz",
  ".dem.xz",
  ".dem.bz2",
  ".dem.zst",
] as const;

export interface CompressedDemoLimits {
  maxSourceBytes: number;
  maxDemoBytes: number;
  maxCompressionRatio: number;
  maxZipEntries: number;
  timeoutMs: number;
}

export interface PreparedUploadedDemo {
  bytes: Buffer;
  sha256: string;
  sourceFormat: "raw" | "zip" | "gzip" | "xz" | "bzip2" | "zstd";
}

const magic = {
  demo: Buffer.from("HL2DEMO\0", "ascii"),
  zip: Buffer.from([0x50, 0x4b]),
  gzip: Buffer.from([0x1f, 0x8b]),
  xz: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  bzip2: Buffer.from("BZh", "ascii"),
  zstd: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
};

const startsWith = (value: Uint8Array, prefix: Uint8Array) =>
  value.byteLength >= prefix.byteLength &&
  prefix.every((byte, index) => value[index] === byte);

export function isSupportedDemoFilename(filename: string): boolean {
  if (!filename || basename(filename) !== filename || /[\\/\0]/.test(filename))
    return false;
  const lower = filename.toLowerCase();
  return supportedDemoExtensions.some((extension) => lower.endsWith(extension));
}

function validateLimits(limits: CompressedDemoLimits): void {
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${name} must be a positive safe integer`);
}

function assertBoundedExpansion(
  sourceBytes: number,
  demoBytes: number,
  limits: CompressedDemoLimits,
): void {
  if (demoBytes < 1 || demoBytes > limits.maxDemoBytes)
    throw new Error("expanded demo exceeds byte limit");
  if (demoBytes / Math.max(1, sourceBytes) > limits.maxCompressionRatio)
    throw new Error("demo compression ratio exceeds limit");
}

function runBoundedDecompressor(
  executable: "/usr/bin/bzip2" | "/usr/bin/xz",
  input: Buffer,
  limits: CompressedDemoLimits,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/prlimit",
      [
        `--as=${512 * 1024 * 1024}`,
        "--cpu=20",
        executable,
        "--decompress",
        "--stdout",
      ],
      { detached: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const output: Buffer[] = [];
    let outputBytes = 0;
    let errors = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(Buffer.concat(output));
    };
    const terminate = (error: Error) => {
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The process may have exited between the limit check and signal.
        }
      finish(error);
    };
    const timeout = setTimeout(
      () =>
        terminate(new Error("demo decompression exceeded wall-clock limit")),
      limits.timeoutMs,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > limits.maxDemoBytes)
        terminate(new Error("expanded demo exceeds byte limit"));
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.length < 4_096)
        errors += chunk.toString("utf8").slice(0, 4_096 - errors.length);
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (settled) return;
      if (code !== 0)
        finish(
          new Error(
            `demo decompression failed (${signal ?? code}): ${errors.trim()}`,
          ),
        );
      else finish();
    });
    child.stdin.on("error", (error) => terminate(error));
    child.stdin.end(input);
  });
}

export async function prepareUploadedDemo(
  filename: string,
  source: Uint8Array,
  limits: CompressedDemoLimits,
): Promise<PreparedUploadedDemo> {
  validateLimits(limits);
  if (!isSupportedDemoFilename(filename))
    throw new Error("unsupported demo filename or unsafe path");
  if (source.byteLength < 1 || source.byteLength > limits.maxSourceBytes)
    throw new Error("compressed source exceeds byte limit");
  const input = Buffer.from(source);
  const lower = filename.toLowerCase();
  let bytes: Buffer;
  let sourceFormat: PreparedUploadedDemo["sourceFormat"];
  if (lower.endsWith(".dem")) {
    if (!startsWith(input, magic.demo))
      throw new Error("demo content does not match the .dem extension");
    bytes = input;
    sourceFormat = "raw";
  } else if (lower.endsWith(".zip")) {
    if (!startsWith(input, magic.zip))
      throw new Error("archive content does not match the .zip extension");
    const zipLimits: ZipLimits = {
      maxEntries: limits.maxZipEntries,
      maxExpandedBytes: limits.maxDemoBytes,
      maxEntryBytes: limits.maxDemoBytes,
      maxCompressionRatio: limits.maxCompressionRatio,
    };
    const entries = inspectZip(input, zipLimits);
    const demos = entries.filter(
      (entry) =>
        extname(entry.name).toLowerCase() === ".dem" &&
        !entry.name.includes("/"),
    );
    if (demos.length !== 1 || entries.length !== 1)
      throw new Error("ZIP must contain exactly one top-level .dem file");
    bytes = extractEntry(input, demos[0]!, zipLimits);
    sourceFormat = "zip";
  } else if (lower.endsWith(".dem.gz")) {
    if (!startsWith(input, magic.gzip))
      throw new Error("compressed content does not match the .gz extension");
    bytes = gunzipSync(input, { maxOutputLength: limits.maxDemoBytes + 1 });
    sourceFormat = "gzip";
  } else if (lower.endsWith(".dem.xz")) {
    if (!startsWith(input, magic.xz))
      throw new Error("compressed content does not match the .xz extension");
    bytes = await runBoundedDecompressor("/usr/bin/xz", input, limits);
    sourceFormat = "xz";
  } else if (lower.endsWith(".dem.bz2")) {
    if (!startsWith(input, magic.bzip2))
      throw new Error("compressed content does not match the .bz2 extension");
    bytes = await runBoundedDecompressor("/usr/bin/bzip2", input, limits);
    sourceFormat = "bzip2";
  } else {
    if (!startsWith(input, magic.zstd))
      throw new Error("compressed content does not match the .zst extension");
    bytes = zstdDecompressSync(input, {
      maxOutputLength: limits.maxDemoBytes + 1,
    });
    sourceFormat = "zstd";
  }
  assertBoundedExpansion(input.byteLength, bytes.byteLength, limits);
  if (!startsWith(bytes, magic.demo))
    throw new Error("expanded content is not a Source demo");
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceFormat,
  };
}
