import { createHash } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostedObjectStore, ObjectMetadata } from "@l4dstats/storage";
import { afterEach, describe, expect, it } from "vitest";
import { processEphemeralHostedSource } from "./hosted-source.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

class MemoryObjects implements HostedObjectStore {
  public deleted = false;
  public constructor(
    private bytes: Uint8Array,
    private readonly digest = createHash("sha256").update(bytes).digest("hex"),
  ) {}
  async head(key: string): Promise<ObjectMetadata | undefined> {
    return this.deleted
      ? undefined
      : {
          key,
          bytes: this.bytes.byteLength,
          sha256: this.digest,
          contentType: "application/octet-stream",
        };
  }
  async get(): Promise<Uint8Array> {
    return this.bytes.slice();
  }
  async getRange(): Promise<Uint8Array> {
    throw new Error("unused");
  }
  async put(): Promise<ObjectMetadata> {
    throw new Error("unused");
  }
  async delete(): Promise<void> {
    this.deleted = true;
    this.bytes = new Uint8Array();
  }
}

describe("processEphemeralHostedSource", () => {
  it("deletes verified remote and local bytes only after durable processing", async () => {
    const workRoot = await mkdtemp(join(tmpdir(), "l4dstats-source-"));
    roots.push(workRoot);
    const bytes = new TextEncoder().encode("HL2DEMO fixture");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const store = new MemoryObjects(bytes);
    let materializedPath = "";
    const output = await processEphemeralHostedSource({
      source: {
        kind: "object",
        bucket: "temporary",
        key: "uploads/job.dem",
        sha256: digest,
        bytes: bytes.byteLength,
        filename: "job.dem",
      },
      store,
      workRoot,
      maxBytes: 1024,
      async process(source) {
        materializedPath = source.path;
        await expect(access(source.path)).resolves.toBeUndefined();
        expect(store.deleted).toBe(false);
        return "committed";
      },
    });
    expect(output).toBe("committed");
    expect(store.deleted).toBe(true);
    await expect(access(materializedPath)).rejects.toThrow();
  });

  it("deletes a corrupt source and never invokes processing", async () => {
    const workRoot = await mkdtemp(join(tmpdir(), "l4dstats-source-"));
    roots.push(workRoot);
    const bytes = new TextEncoder().encode("corrupt");
    const store = new MemoryObjects(bytes, "a".repeat(64));
    let invoked = false;
    await expect(
      processEphemeralHostedSource({
        source: {
          kind: "object",
          bucket: "temporary",
          key: "uploads/job.dem",
          sha256: "a".repeat(64),
          bytes: bytes.byteLength,
          filename: "job.dem",
        },
        store,
        workRoot,
        maxBytes: 1024,
        async process() {
          invoked = true;
        },
      }),
    ).rejects.toThrow("SHA-256");
    expect(invoked).toBe(false);
    expect(store.deleted).toBe(true);
  });
});
