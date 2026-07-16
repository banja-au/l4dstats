import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  acquire,
  AcquisitionError,
  assertAllowedHttps,
  discoverZipUrls,
  extractEntry,
  inspectZip,
  type ZipLimits,
} from "./index.js";

const limits: ZipLimits = {
  maxEntries: 4,
  maxExpandedBytes: 1024,
  maxEntryBytes: 512,
  maxCompressionRatio: 20,
};

describe("URL policy and discovery", () => {
  it("rejects non-HTTPS, credentials, and hosts outside the exact allowlist", () => {
    for (const value of [
      "http://demos.test/a",
      "https://evil.test/a",
      "https://x@y.test/a",
    ]) {
      expect(() =>
        assertAllowedHttps(new URL(value), ["demos.test"]),
      ).toThrowError(AcquisitionError);
    }
  });

  it("streams, resolves, filters and deduplicates archive links", async () => {
    const html =
      '<a href="one.zip">one</a><a href="/two.ZIP#x">two</a><a href="one.zip">dup</a><a href="https://evil.test/x.zip">bad</a>';
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(html.slice(0, 30)));
              controller.enqueue(new TextEncoder().encode(html.slice(30)));
              controller.close();
            },
          }),
        ),
    );
    const found: string[] = [];
    for await (const url of discoverZipUrls(
      new URL("https://demos.test/list/"),
      { allowedHosts: ["demos.test"], fetch: fetcher },
    ))
      found.push(url.href);
    expect(found).toEqual([
      "https://demos.test/list/one.zip",
      "https://demos.test/two.ZIP",
    ]);
  });

  it("validates every redirect before following it", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.test/file.zip" },
        }),
    );
    await expect(async () => {
      for await (const _ of discoverZipUrls(new URL("https://demos.test/"), {
        allowedHosts: ["demos.test"],
        fetch: fetcher,
      }))
        void _;
    }).rejects.toMatchObject({ code: "ALLOWLIST" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("content-addressed acquisition", () => {
  it("hashes, publishes atomically and reuses an identical artifact", async () => {
    const store = await mkdtemp(join(tmpdir(), "witchwatch-acquire-"));
    const body = new TextEncoder().encode("archive bytes");
    const fetcher = vi.fn(
      async () =>
        new Response(body, {
          headers: { "content-length": String(body.length) },
        }),
    );
    const options = {
      allowedHosts: ["demos.test"],
      fetch: fetcher,
      store,
      maxBytes: 100,
    };
    const first = await acquire(new URL("https://demos.test/a.zip"), options);
    const second = await acquire(new URL("https://demos.test/a.zip"), options);
    expect(first.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(second.artifactPath).toBe(first.artifactPath);
    expect(await readFile(first.artifactPath)).toEqual(Buffer.from(body));
    expect(
      (await readdir(store)).some((name) => name.startsWith(".partial-")),
    ).toBe(false);
  });

  it("removes partial files after a streamed byte-limit failure", async () => {
    const store = await mkdtemp(join(tmpdir(), "witchwatch-limit-"));
    const fetcher = vi.fn(async () => new Response(new Uint8Array(20)));
    await expect(
      acquire(new URL("https://demos.test/a.zip"), {
        allowedHosts: ["demos.test"],
        fetch: fetcher,
        store,
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_LIMIT" });
    expect(await readdir(store)).toEqual([]);
  });

  it("cancels an in-progress body and removes its partial file", async () => {
    const store = await mkdtemp(join(tmpdir(), "witchwatch-cancel-"));
    const controller = new AbortController();
    const fetcher = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new Uint8Array([1]));
              init?.signal?.addEventListener("abort", () =>
                stream.error(init.signal?.reason),
              );
            },
          }),
        ),
    );
    const pending = acquire(new URL("https://demos.test/a.zip"), {
      allowedHosts: ["demos.test"],
      fetch: fetcher,
      store,
      maxBytes: 10,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(await readdir(store)).toEqual([]);
  });
});

describe("ZIP safety", () => {
  it("inspects and extracts stored and deflated files", () => {
    for (const method of [0, 8]) {
      const archive = zip(
        "folder/demo.dem",
        Buffer.from("demo telemetry"),
        method,
      );
      const [entry] = inspectZip(archive, limits);
      expect(entry?.name).toBe("folder/demo.dem");
      expect(extractEntry(archive, entry!, limits).toString()).toBe(
        "demo telemetry",
      );
    }
  });

  it.each([
    "../escape.dem",
    "/absolute.dem",
    "C:/drive.dem",
    "a\\evil.dem",
    "a//b.dem",
  ])("rejects unsafe path %s", (name) => {
    expect(() =>
      inspectZip(zip(name, Buffer.from("x"), 0), limits),
    ).toThrowError(/unsafe ZIP entry path/);
  });

  it("rejects entry count, expanded-size, ratio, symlink and truncation attacks", () => {
    expect(() =>
      inspectZip(zip("huge.dem", Buffer.alloc(400, 0), 8), {
        ...limits,
        maxCompressionRatio: 2,
      }),
    ).toThrowError(/compression ratio/);
    expect(() =>
      inspectZip(zip("huge.dem", Buffer.alloc(600), 0), limits),
    ).toThrowError(/expanded size/);
    expect(() =>
      inspectZip(zip("link.dem", Buffer.from("target"), 0, 0o120777), limits),
    ).toThrowError(/symbolic links/);
    expect(() =>
      inspectZip(zip("ok.dem", Buffer.from("x"), 0).subarray(0, 20), limits),
    ).toThrowError(/missing ZIP/);
    expect(() => inspectZip(manyZip(5), limits)).toThrowError(
      /too many ZIP entries/,
    );
  });
});

function zip(
  name: string,
  contents: Buffer,
  method: number,
  mode = 0o100644,
): Buffer {
  const nameBytes = Buffer.from(name),
    compressed = method === 8 ? deflateRawSync(contents) : contents;
  const checksum = crc32(contents);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(3 << 8, 4);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE((mode << 16) >>> 0, 38);
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

function manyZip(count: number): Buffer {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const single = zip(`${i}.dem`, Buffer.from("x"), 0);
    const eocdAt = single.length - 22,
      dirAt = single.readUInt32LE(eocdAt + 16);
    const local = single.subarray(0, dirAt),
      central = Buffer.from(single.subarray(dirAt, eocdAt));
    central.writeUInt32LE(offset, 42);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals),
    eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
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
