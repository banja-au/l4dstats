import { inflateRawSync } from "node:zlib";
import { AcquisitionError } from "./errors.js";

export interface ZipLimits {
  maxEntries: number;
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxCompressionRatio: number;
}
export interface ZipEntry {
  name: string;
  compressedBytes: number;
  expandedBytes: number;
  crc32: number;
  method: number;
  localOffset: number;
}
const u16 = (b: Buffer, o: number) => b.readUInt16LE(o);
const u32 = (b: Buffer, o: number) => b.readUInt32LE(o);

/** Inspects the central directory and rejects unsafe paths, links, encryption and resource abuse. */
export function inspectZip(data: Buffer, limits: ZipLimits): ZipEntry[] {
  const eocd = findSignature(
    data,
    0x06054b50,
    Math.max(0, data.length - 65_557),
  );
  if (eocd < 0 || eocd + 22 > data.length)
    throw invalid("missing ZIP end record");
  const count = u16(data, eocd + 10);
  if (
    u16(data, eocd + 4) !== 0 ||
    u16(data, eocd + 6) !== 0 ||
    u16(data, eocd + 8) !== count
  )
    throw invalid("multi-disk ZIPs are unsupported");
  if (count > limits.maxEntries) throw limited("too many ZIP entries");
  const directorySize = u32(data, eocd + 12),
    directoryOffset = u32(data, eocd + 16);
  if (directoryOffset + directorySize > eocd)
    throw invalid("central directory is out of bounds");
  const entries: ZipEntry[] = [];
  let offset = directoryOffset,
    total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > data.length || u32(data, offset) !== 0x02014b50)
      throw invalid("invalid central directory entry");
    const flags = u16(data, offset + 8),
      method = u16(data, offset + 10),
      crc32 = u32(data, offset + 16);
    const compressedBytes = u32(data, offset + 20),
      expandedBytes = u32(data, offset + 24);
    const nameLength = u16(data, offset + 28),
      extraLength = u16(data, offset + 30),
      commentLength = u16(data, offset + 32);
    const external = u32(data, offset + 38),
      localOffset = u32(data, offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > data.length) throw invalid("truncated central directory entry");
    const name = data
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    validatePath(name);
    if (flags & 1) throw invalid("encrypted ZIP entries are unsupported");
    const unixMode = external >>> 16;
    if ((unixMode & 0o170000) === 0o120000)
      throw invalid("symbolic links are forbidden");
    if (method !== 0 && method !== 8)
      throw invalid("unsupported compression method");
    total += expandedBytes;
    if (expandedBytes > limits.maxEntryBytes || total > limits.maxExpandedBytes)
      throw limited("expanded size exceeds limit");
    if (
      expandedBytes > 0 &&
      (compressedBytes === 0 ||
        expandedBytes / compressedBytes > limits.maxCompressionRatio)
    )
      throw limited("compression ratio exceeds limit");
    entries.push({
      name,
      compressedBytes,
      expandedBytes,
      crc32,
      method,
      localOffset,
    });
    offset = end;
  }
  if (offset !== directoryOffset + directorySize)
    throw invalid("central directory size mismatch");
  return entries;
}

export function extractEntry(
  data: Buffer,
  entry: ZipEntry,
  limits: ZipLimits,
): Buffer {
  if (
    entry.localOffset + 30 > data.length ||
    u32(data, entry.localOffset) !== 0x04034b50
  )
    throw invalid("invalid local entry");
  const nameLength = u16(data, entry.localOffset + 26),
    extraLength = u16(data, entry.localOffset + 28);
  const localMethod = u16(data, entry.localOffset + 8);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedBytes;
  if (end > data.length) throw invalid("truncated entry data");
  const localName = data
    .subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength)
    .toString("utf8");
  if (localName !== entry.name || localMethod !== entry.method)
    throw invalid("local entry disagrees with central directory");
  let output: Buffer;
  try {
    output =
      entry.method === 0
        ? Buffer.from(data.subarray(start, end))
        : inflateRawSync(data.subarray(start, end), {
            maxOutputLength: Math.min(
              entry.expandedBytes + 1,
              limits.maxEntryBytes + 1,
            ),
          });
  } catch (error) {
    throw invalid(
      `invalid deflate stream: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (output.length !== entry.expandedBytes)
    throw invalid("expanded size mismatch");
  if (crc32(output) !== entry.crc32) throw invalid("CRC-32 mismatch");
  return output;
}

function validatePath(name: string): void {
  if (
    !name ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((part) => part === ".." || part === "")
  )
    throw invalid("unsafe ZIP entry path");
}
function findSignature(data: Buffer, signature: number, start: number): number {
  for (let i = data.length - 22; i >= start; i -= 1)
    if (u32(data, i) === signature) return i;
  return -1;
}
const invalid = (message: string) =>
  new AcquisitionError("INVALID_ARCHIVE", message);
const limited = (message: string) => new AcquisitionError("ZIP_LIMIT", message);
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
