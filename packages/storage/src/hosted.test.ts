import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { R2BucketLike } from "./r2.js";
import { R2ObjectStore } from "./r2.js";
import { HostedJobRepository } from "./hosted.js";
import { TursoSqlClient } from "./turso.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function repository(): Promise<{
  repository: HostedJobRepository;
  close(): void;
}> {
  const root = await mkdtemp(join(tmpdir(), "l4dstats-hosted-"));
  roots.push(root);
  const client = TursoSqlClient.fromEnvironment({
    TURSO_DATABASE_URL: `file:${join(root, "hosted.db")}`,
  });
  const repository = new HostedJobRepository(client);
  await repository.migrate();
  return { repository, close: () => client.close() };
}

const source = {
  kind: "object" as const,
  bucket: "temporary",
  key: "uploads/job/demo.dem",
  sha256: "a".repeat(64),
  bytes: 1024,
  filename: "demo.dem",
};

describe("HostedJobRepository", () => {
  it("enqueues idempotently and leases one job", async () => {
    const { repository: repo, close } = await repository();
    try {
      const first = await repo.enqueue(source, "upload:fixture");
      const duplicate = await repo.enqueue(source, "upload:fixture");
      expect(duplicate.id).toBe(first.id);

      const claimed = await repo.claimNext({
        owner: "worker-a",
        leaseMs: 60_000,
        at: new Date("2026-07-19T00:00:00.000Z"),
      });
      expect(claimed).toMatchObject({
        id: first.id,
        state: "running",
        attempt: 1,
        leaseOwner: "worker-a",
      });
      expect(
        await repo.claimNext({
          owner: "worker-b",
          leaseMs: 60_000,
          at: new Date("2026-07-19T00:00:30.000Z"),
        }),
      ).toBeUndefined();
    } finally {
      close();
    }
  });

  it("reclaims an expired lease and rejects the former owner", async () => {
    const { repository: repo, close } = await repository();
    try {
      const job = await repo.enqueue(
        source,
        "upload:reclaim",
        new Date("2026-07-19T00:00:00.000Z"),
      );
      await repo.claimNext({
        owner: "worker-a",
        leaseMs: 1_000,
        at: new Date("2026-07-19T00:00:00.000Z"),
      });
      const reclaimed = await repo.claimNext({
        owner: "worker-b",
        leaseMs: 60_000,
        at: new Date("2026-07-19T00:00:02.000Z"),
      });
      expect(reclaimed).toMatchObject({
        id: job.id,
        attempt: 2,
        leaseOwner: "worker-b",
      });
      await expect(
        repo.finish({ id: job.id, owner: "worker-a", state: "succeeded" }),
      ).rejects.toThrow("lease was lost");
      await repo.finish({
        id: job.id,
        owner: "worker-b",
        state: "succeeded",
      });
      await expect(repo.getJob(job.id)).resolves.toMatchObject({
        state: "succeeded",
        leaseOwner: null,
      });
    } finally {
      close();
    }
  });

  it("releases a failed attempt for an immediate bounded retry", async () => {
    const { repository: repo, close } = await repository();
    try {
      const job = await repo.enqueue(source, "upload:retry");
      await repo.claim({ id: job.id, owner: "worker-a", leaseMs: 60_000 });
      await expect(
        repo.retry({
          id: job.id,
          owner: "worker-a",
          message: "Analysis attempt failed; retrying",
        }),
      ).resolves.toMatchObject({
        state: "queued",
        attempt: 1,
        leaseOwner: null,
        message: "Analysis attempt failed; retrying",
      });
      await expect(
        repo.claim({ id: job.id, owner: "worker-b", leaseMs: 60_000 }),
      ).resolves.toMatchObject({
        state: "running",
        attempt: 2,
        leaseOwner: "worker-b",
      });
    } finally {
      close();
    }
  });

  it("requeues a failed idempotent upload only after a new source is stored", async () => {
    const { repository: repo, close } = await repository();
    try {
      const job = await repo.enqueue(source, "upload:failed-reupload");
      await repo.claim({ id: job.id, owner: "worker-a", leaseMs: 60_000 });
      await repo.finish({
        id: job.id,
        owner: "worker-a",
        state: "failed",
        message: "bounded attempts exhausted",
      });
      const replacement = { ...source, key: "uploads/replacement/demo.dem" };
      await expect(
        repo.enqueue(replacement, "upload:failed-reupload"),
      ).resolves.toMatchObject({
        id: job.id,
        state: "queued",
        source: replacement,
        attempt: 0,
        progress: 0,
        message: null,
      });
      await expect(
        repo.enqueue(
          { ...source, key: "uploads/concurrent-loser/demo.dem" },
          "upload:failed-reupload",
        ),
      ).resolves.toMatchObject({ source: replacement, state: "queued" });
    } finally {
      close();
    }
  });

  it("defers transient infrastructure capacity without consuming an attempt", async () => {
    const { repository: repo, close } = await repository();
    try {
      const job = await repo.enqueue(source, "upload:capacity");
      await repo.claim({ id: job.id, owner: "worker-a", leaseMs: 60_000 });
      await expect(
        repo.defer({
          id: job.id,
          owner: "worker-a",
          message: "Hosted analysis capacity is busy; retrying",
        }),
      ).resolves.toMatchObject({
        state: "queued",
        attempt: 0,
        leaseOwner: null,
      });
    } finally {
      close();
    }
  });

  it("persists a durable game association for hosted analyses", async () => {
    const { repository: repo, close } = await repository();
    try {
      const job = await repo.enqueue(source, "upload:hosted-game");
      const engineResult = {
        demo: {
          mapName: "c5m4_quarter",
          session: {
            serverToken: "server-token",
            rosterToken: "roster-token",
            campaign: "c5",
            serverCount: 4,
            chapter: 4,
            evidence: ["server-token", "roster-token"],
          },
          stats: {
            players: [
              {
                alias: "Coach",
                identity: {
                  displayName: "Coach",
                  steamId64: "76561198000000007",
                },
              },
            ],
          },
        },
      };
      await repo.recordAnalysis({
        jobId: job.id,
        demoSha256: "b".repeat(64),
        resultKey: "sha256/bb/result",
        resultSha256: "c".repeat(64),
        resultBytes: 1024,
        engineResult,
      });
      const gameId = await repo.getGameIdForJob(job.id);
      expect(gameId).toMatch(/^[a-f0-9-]{36}$/);
      await expect(repo.getGame(gameId!)).resolves.toMatchObject({
        id: gameId,
        confidence: "provisional",
        evidence: ["server-token", "roster-token"],
        analyses: [{ jobId: job.id, demoSha256: "b".repeat(64) }],
      });
      await expect(
        repo.assignAnalysisToGame({
          jobId: job.id,
          demoSha256: "b".repeat(64),
          engineResult,
        }),
      ).resolves.toBe(gameId);
      await expect(
        repo.getPlayerHistory("76561198000000007"),
      ).resolves.toMatchObject({
        steamId64: "76561198000000007",
        displayName: "Coach",
        games: [
          {
            id: gameId,
            demos: [{ jobId: job.id, mapName: "c5m4_quarter" }],
          },
        ],
      });
    } finally {
      close();
    }
  });
});

class MemoryR2 implements R2BucketLike {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; sha256: string; contentType: string }
  >();

  async head(key: string) {
    const value = this.objects.get(key);
    return value
      ? {
          key,
          size: value.bytes.byteLength,
          customMetadata: { sha256: value.sha256 },
          httpMetadata: { contentType: value.contentType },
        }
      : null;
  }

  async get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ) {
    const value = this.objects.get(key);
    if (!value) return null;
    const bytes = options
      ? value.bytes.slice(
          options.range.offset,
          options.range.offset + options.range.length,
        )
      : value.bytes;
    return {
      key,
      size: value.bytes.byteLength,
      customMetadata: { sha256: value.sha256 },
      httpMetadata: { contentType: value.contentType },
      async arrayBuffer() {
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      },
    };
  }

  async put(
    key: string,
    bytes: Uint8Array,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { contentType: string };
    },
  ) {
    this.objects.set(key, {
      bytes: bytes.slice(),
      sha256: options.customMetadata.sha256!,
      contentType: options.httpMetadata.contentType,
    });
    return this.head(key);
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe("R2ObjectStore", () => {
  it("stores, ranges, verifies metadata and confirms deletion", async () => {
    const store = new R2ObjectStore(new MemoryR2());
    const bytes = new TextEncoder().encode("derived-artifact");
    const sha256 = "b".repeat(64);
    await expect(
      store.put("sha256/bb/hash", bytes, {
        sha256,
        contentType: "application/json",
      }),
    ).resolves.toMatchObject({ bytes: bytes.byteLength, sha256 });
    await expect(store.getRange("sha256/bb/hash", 8, 16)).resolves.toEqual(
      new TextEncoder().encode("artifact"),
    );
    await store.delete("sha256/bb/hash");
    await expect(store.head("sha256/bb/hash")).resolves.toBeUndefined();
  });
});
