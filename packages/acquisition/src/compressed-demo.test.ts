import { createHash } from "node:crypto";
import { deflateRawSync, gzipSync, zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  isSupportedDemoFilename,
  prepareUploadedDemo,
  type CompressedDemoLimits,
} from "./compressed-demo.js";

const demo = Buffer.concat([
  Buffer.from("HL2DEMO\0", "ascii"),
  Buffer.from("bounded fixture"),
]);
const limits: CompressedDemoLimits = {
  maxSourceBytes: 1_024 * 1_024,
  maxDemoBytes: 1_024 * 1_024,
  maxCompressionRatio: 100,
  maxZipEntries: 4,
  timeoutMs: 5_000,
};

describe("compressed hosted demo preparation", () => {
  it("accepts raw, ZIP, gzip, xz, bzip2 and zstd single-demo inputs", async () => {
    const cases: Array<[string, Buffer, string]> = [
      ["match.dem", demo, "raw"],
      ["match.dem.zip", zip("match.dem", demo), "zip"],
      ["cedapug-match.zip", zip("match.dem", demo), "zip"],
      ["match.dem.gz", gzipSync(demo), "gzip"],
      [
        "match.dem.xz",
        Buffer.from(
          "/Td6WFoAAATm1rRGAgAhARYAAAB0L+WjAQAWSEwyREVNTwBib3VuZGVkIGZpeHR1cmUAAHXqnmirgb+XAAEvF4EISbEftvN9AQAAAAAEWVo=",
          "base64",
        ),
        "xz",
      ],
      [
        "match.dem.bz2",
        Buffer.from(
          "QlpoOTFBWSZTWYPwQUIAAALdgEAAQAAQAAZGlyGWQCAAIoA2UNDIUwmmgNMRClr5AIqvTpW5J2d/i7kinChIQfggoQA=",
          "base64",
        ),
        "bzip2",
      ],
      ["match.dem.zst", zstdCompressSync(demo), "zstd"],
    ];
    for (const [filename, source, format] of cases) {
      const prepared = await prepareUploadedDemo(filename, source, limits);
      expect(prepared.bytes).toEqual(demo);
      expect(prepared.sourceFormat).toBe(format);
      expect(prepared.sha256).toBe(
        createHash("sha256").update(demo).digest("hex"),
      );
    }
  });

  it("requires safe exact suffixes and matching magic", async () => {
    for (const filename of [
      "../match.dem.zip",
      "folder/match.dem",
      "match.tar.gz",
      "match.dem.7z",
      "match.dem.zip.exe",
    ])
      expect(isSupportedDemoFilename(filename)).toBe(false);
    expect(isSupportedDemoFilename("match.zip")).toBe(true);
    await expect(
      prepareUploadedDemo("match.dem.gz", demo, limits),
    ).rejects.toThrow("does not match");
    await expect(
      prepareUploadedDemo("match.dem", gzipSync(demo), limits),
    ).rejects.toThrow("does not match");
  });

  it("rejects traversal, extra members, nested content and non-demo output", async () => {
    await expect(
      prepareUploadedDemo("match.dem.zip", zip("../match.dem", demo), limits),
    ).rejects.toThrow("unsafe ZIP entry path");
    await expect(
      prepareUploadedDemo(
        "match.dem.zip",
        manyZip([
          ["one.dem", demo],
          ["two.dem", demo],
        ]),
        limits,
      ),
    ).rejects.toThrow("exactly one");
    await expect(
      prepareUploadedDemo("match.dem.gz", gzipSync(gzipSync(demo)), limits),
    ).rejects.toThrow("not a Source demo");
    await expect(
      prepareUploadedDemo("match.dem.gz", gzipSync("not a demo"), limits),
    ).rejects.toThrow("not a Source demo");
  });

  it("fails closed on source, expanded-size and compression-ratio limits", async () => {
    await expect(
      prepareUploadedDemo("match.dem", demo, {
        ...limits,
        maxSourceBytes: demo.length - 1,
      }),
    ).rejects.toThrow("source exceeds byte limit");
    const largeDemo = Buffer.concat([
      Buffer.from("HL2DEMO\0"),
      Buffer.alloc(10_000),
    ]);
    await expect(
      prepareUploadedDemo("match.dem.gz", gzipSync(largeDemo), {
        ...limits,
        maxDemoBytes: 1_000,
      }),
    ).rejects.toThrow();
    await expect(
      prepareUploadedDemo("match.dem.gz", gzipSync(largeDemo), {
        ...limits,
        maxCompressionRatio: 2,
      }),
    ).rejects.toThrow("compression ratio exceeds limit");
  });
});

function zip(name: string, contents: Buffer): Buffer {
  const nameBytes = Buffer.from(name);
  const compressed = deflateRawSync(contents);
  const checksum = crc32(contents);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(3 << 8, 4);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  const directoryOffset = local.length + nameBytes.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([
    local,
    nameBytes,
    compressed,
    central,
    nameBytes,
    eocd,
  ]);
}

function manyZip(entries: Array<[string, Buffer]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const single = zip(name, contents);
    const eocdAt = single.length - 22;
    const directoryAt = single.readUInt32LE(eocdAt + 16);
    const local = single.subarray(0, directoryAt);
    const central = Buffer.from(single.subarray(directoryAt, eocdAt));
    central.writeUInt32LE(offset, 42);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
