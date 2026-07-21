import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentAddressedStore, WorkbenchRepository, sha256 } from "./index.js";

const cleanup: string[] = [];
afterEach(async () =>
  Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("WorkbenchRepository", () => {
  it("reports aggregate operational state without exposing job data", () => {
    const repo = new WorkbenchRepository();
    const queued = repo.enqueue(
      {
        kind: "local",
        path: "/private/demo.dem",
        sha256: "a".repeat(64),
        bytes: 7,
      },
      "metrics-fixture",
    );
    repo.db
      .prepare("UPDATE jobs SET created_at=? WHERE id=?")
      .run("2026-01-01T00:00:00.000Z", queued.id);
    expect(
      repo.operationalMetrics(new Date("2026-01-01T00:05:00.000Z")),
    ).toEqual({
      jobs: {
        queued: 1,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
      oldestQueuedAgeSeconds: 300,
    });
    repo.close();
  });
  it("enqueues idempotently and enforces retry and cancellation transitions", () => {
    const repo = new WorkbenchRepository();
    const source = {
      kind: "remote" as const,
      url: "https://cedapug.com/demos/a.zip",
    };
    const first = repo.enqueue(source, "same");
    expect(repo.enqueue(source, "same").id).toBe(first.id);
    expect(repo.claimNext()?.state).toBe("running");
    expect(repo.progress(first.id, 0.4, "Decoding").progress).toBe(0.4);
    expect(repo.cancel(first.id).state).toBe("cancelled");
    expect(repo.retry(first.id).state).toBe("queued");
    expect(repo.claimNext()?.attempt).toBe(2);
    expect(repo.finish(first.id, "failed", "bad demo").state).toBe("failed");
    expect(repo.retry(first.id).state).toBe("queued");
    expect(() => repo.retry(first.id)).toThrow();
    expect(repo.auditEvents(first.id)).toHaveLength(7);
    repo.close();
  });
  it("bounds pagination, notes, and tick windows", () => {
    const repo = new WorkbenchRepository();
    repo.upsertCase({
      id: "case-a",
      playerKey: "private-hash",
      status: "unreviewed",
      score: { status: "insufficient-data" },
    });
    expect(repo.addNote("case-a", "Need more context", 125).tick).toBe(125);
    expect(repo.listNotes("case-a")).toHaveLength(1);
    expect(repo.updateCaseStatus("case-a", "in-review").status).toBe(
      "in-review",
    );
    expect(() =>
      repo.updateCaseStatus("case-a", "invalid" as "unreviewed"),
    ).toThrow(RangeError);
    repo.putWindow("case-a", 100, 200, { ticks: [100, 150, 199] });
    expect(repo.getWindow("case-a", 120, 180)).toEqual([
      {
        startTick: 120,
        endTick: 180,
        payload: { ticks: [100, 150, 199] },
      },
    ]);
    expect(() => repo.getWindow("case-a", 0, 3001)).toThrow(RangeError);
    expect(() => repo.listCases(101)).toThrow(RangeError);
    expect(() => repo.addNote("case-a", "", null)).toThrow(RangeError);
    repo.setCaseLineage("case-a", {
      artifacts: { demoSha256: "a".repeat(64) },
      versions: { parser: "controlled@1" },
    });
    expect(repo.getCaseLineage("case-a")).toMatchObject({
      artifacts: { demoSha256: "a".repeat(64) },
    });
    repo.setCasePresentation("case-a", {
      schemaVersion: 1,
      id: "case-a",
      alias: "Controlled",
      identityLabel: "Demo-local epoch",
      provenance: { controlledFixture: true, label: "test" },
      demos: [],
      evidence: [],
      association: {
        kind: "demo-local-epoch",
        corroboratingDemoCount: 0,
        explanation: "No stable identity",
      },
      summary: { encounterCount: 0, independentSignalFamilies: [] },
    });
    expect(repo.getCasePresentation("case-a")).toMatchObject({
      association: { kind: "demo-local-epoch", corroboratingDemoCount: 0 },
    });
    expect(() =>
      repo.setCasePresentation("case-a", {
        ...repo.getCasePresentation("case-a"),
        demos: [
          {
            id: "fake-corroboration",
            sha256: "b".repeat(64),
            mapName: "fixture",
            sourceLabel: "fixture",
            quality: { value: null, basis: ["not evaluated"] },
            corroboration: "same-stable-player",
          },
        ],
      }),
    ).toThrow(/demo-local epochs/);
    expect(() =>
      repo.setCasePresentation("case-a", {
        ...repo.getCasePresentation("case-a"),
        association: {
          kind: "stable-privacy-token",
          stableToken: "STEAM_1:0:123",
          corroboratingDemoCount: 0,
          explanation: "raw identifier must be rejected",
        },
      }),
    ).toThrow(/privacy-preserving/);
    repo.close();
  });
  it("clips tick-addressed records and enforces stored and aggregate bounds", () => {
    const repo = new WorkbenchRepository();
    repo.upsertCase({
      id: "case-a",
      playerKey: "private-hash",
      status: "unreviewed",
      score: { status: "insufficient-data" },
    });
    repo.putWindow("case-a", 0, 600, {
      poses: Array.from({ length: 600 }, (_, tick) => ({ tick, x: tick })),
      events: [{ tick: 100, kind: "shot" }],
    });
    expect(repo.getWindow("case-a", 315, 316)).toEqual([
      {
        startTick: 315,
        endTick: 316,
        payload: { poses: [{ tick: 315, x: 315 }], events: [] },
      },
    ]);
    expect(() => repo.putWindow("case-a", 0, 601, {})).toThrow(RangeError);
    expect(() =>
      repo.putWindow("case-a", 600, 601, { blob: "x".repeat(300_000) }),
    ).toThrow(RangeError);
    for (let index = 0; index < 17; index++)
      repo.putWindow("case-a", 1_000 + index, 1_001 + index, {
        poses: [{ tick: 1_000 + index }],
      });
    expect(() => repo.getWindow("case-a", 1_000, 1_017)).toThrow(RangeError);
    for (let index = 0; index < 3; index++)
      repo.putWindow("case-a", 2_000 + index, 2_001 + index, {
        boundedMetadata: "x".repeat(200_000),
      });
    expect(() => repo.getWindow("case-a", 2_000, 2_003)).toThrow(RangeError);
    repo.close();
  });
  it("recovers expired running leases and caps crash retries", () => {
    const repo = new WorkbenchRepository();
    const job = repo.enqueue(
      { kind: "remote", url: "https://cedapug.com/demos/a.zip" },
      "stale",
    );
    repo.claimNext();
    repo.db
      .prepare("UPDATE jobs SET updated_at=? WHERE id=?")
      .run("2026-01-01T00:00:00.000Z", job.id);
    expect(
      repo.recoverStaleRunning(60_000, {
        at: new Date("2026-01-01T00:02:00.000Z"),
        maxAttempts: 2,
      })[0],
    ).toMatchObject({ state: "queued", attempt: 1, progress: 0 });
    repo.claimNext();
    repo.db
      .prepare("UPDATE jobs SET updated_at=? WHERE id=?")
      .run("2026-01-01T00:00:00.000Z", job.id);
    expect(
      repo.recoverStaleRunning(60_000, {
        at: new Date("2026-01-01T00:02:00.000Z"),
        maxAttempts: 2,
      })[0],
    ).toMatchObject({ state: "failed", attempt: 2 });
    expect(repo.auditEvents(job.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "job.stale-requeued" }),
        expect.objectContaining({ eventType: "job.stale-failed" }),
      ]),
    );
    repo.close();
  });
  it("groups adjacent campaign demos by embedded server and stable roster evidence", () => {
    const repo = new WorkbenchRepository();
    const jobs = ["one", "two", "other", "rematch-one", "rematch-two"].map(
      (key) =>
        repo.enqueue(
          { kind: "remote", url: `https://cedapug.com/demos/${key}.dem` },
          key,
        ),
    );
    const record = (
      jobId: string,
      hash: string,
      serverCount: number,
      chapter: number,
      rosterToken = "roster-a",
    ) =>
      repo.recordJobAnalysis({
        jobId,
        demoSha256: hash.repeat(64).slice(0, 64),
        sourceManifest: {},
        engineResult: {
          schemaVersion: 1,
          demo: {
            sha256: hash.repeat(64).slice(0, 64),
            mapName: `c4m${chapter}_fixture`,
            bytes: 1,
            session: {
              serverToken: "server-a",
              rosterToken,
              serverCount,
              campaign: "c4",
              chapter,
              evidence: ["source-server-count"],
            },
          },
          cases: [],
        },
        engineResultSha256: "f".repeat(64),
      });
    record(jobs[0]!.id, "a", 2, 1);
    record(jobs[1]!.id, "b", 3, 2);
    record(jobs[2]!.id, "c", 4, 3, "roster-b");
    record(jobs[3]!.id, "d", 2, 1);
    record(jobs[4]!.id, "e", 3, 2);
    const gameId = repo.getGameIdForJob(jobs[0]!.id)!;
    expect(repo.getGameIdForJob(jobs[1]!.id)).toBe(gameId);
    expect(repo.getGameIdForJob(jobs[2]!.id)).not.toBe(gameId);
    const rematchId = repo.getGameIdForJob(jobs[3]!.id);
    expect(rematchId).not.toBe(gameId);
    expect(repo.getGameIdForJob(jobs[4]!.id)).toBe(rematchId);
    expect(repo.getGame(gameId)).toMatchObject({
      confidence: "high",
      analyses: [{ jobId: jobs[0]!.id }, { jobId: jobs[1]!.id }],
    });
    repo.close();
  });
  it("groups adjacent custom-campaign maps with strong roster continuity", () => {
    const repo = new WorkbenchRepository();
    const rosters = [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 2, 3, 4, 5, 6, 7, 9],
      [1, 2, 3, 4, 5, 6, 9, 10],
    ];
    const jobs = rosters.map((roster, index) => {
      const job = repo.enqueue(
        { kind: "remote", url: `https://example.invalid/hf0${index + 2}.dem` },
        `custom-${index}`,
      );
      repo.recordJobAnalysis({
        jobId: job.id,
        demoSha256: String(index + 1).repeat(64),
        sourceManifest: {},
        engineResult: {
          demo: {
            mapName: `hf0${index + 2}_fixture`,
            session: {
              serverToken: "server-custom",
              rosterToken: `changed-roster-${index}`,
              serverCount: index + 4,
              campaign: "custom:hf",
              chapter: index + 2,
              evidence: ["custom-campaign-map-sequence-v1"],
            },
            stats: {
              players: roster.map((id) => ({
                identity: {
                  steamId64: `7656119${String(id).padStart(10, "0")}`,
                },
              })),
            },
          },
          cases: [],
        },
        engineResultSha256: "f".repeat(64),
      });
      return job;
    });
    expect(new Set(jobs.map((job) => repo.getGameIdForJob(job.id))).size).toBe(
      1,
    );
    repo.close();
  });
  it("groups the four real 915679 Hard Rain maps without filename evidence", () => {
    const repo = new WorkbenchRepository();
    const maps = [
      { name: "c4m4_milltown_b", chapter: 4, serverCount: 5 },
      { name: "c4m2_sugarmill_a", chapter: 2, serverCount: 3 },
      { name: "c4m1_milltown_a", chapter: 1, serverCount: 2 },
      { name: "c4m3_sugarmill_b", chapter: 3, serverCount: 4 },
    ];
    const jobs = maps.map((_, index) =>
      repo.enqueue(
        { kind: "remote", url: `https://invalid.example/demo-${index}` },
        `real-915679-${index}`,
      ),
    );
    maps.forEach((map, index) =>
      repo.recordJobAnalysis({
        jobId: jobs[index]!.id,
        demoSha256: String(index + 1).repeat(64),
        sourceManifest: {},
        engineResult: {
          schemaVersion: 1,
          demo: {
            sha256: String(index + 1).repeat(64),
            mapName: map.name,
            bytes: 1,
            session: {
              serverToken:
                "cf70b41a0667b3a09df42df4a52cabacaa8de7d0d6f5755a9f18d8ac23e3aeb5",
              rosterToken:
                "8ceadd0507c2042ab8e3cc1f086c66b1faf7fc7c263f9e5c943af4007005a3f9",
              serverCount: map.serverCount,
              campaign: "c4",
              chapter: map.chapter,
              evidence: [
                "hmac-server-identity-v1",
                "stable-human-roster-v1",
                "source-server-count",
                "campaign-map-sequence",
              ],
            },
          },
          cases: [],
        },
        engineResultSha256: "f".repeat(64),
      }),
    );
    const gameIds = jobs.map((job) => repo.getGameIdForJob(job.id));
    expect(new Set(gameIds).size).toBe(1);
    expect(repo.getGame(gameIds[0]!)).toMatchObject({
      confidence: "high",
      analyses: [
        { engineResult: { demo: { mapName: "c4m1_milltown_a" } } },
        { engineResult: { demo: { mapName: "c4m2_sugarmill_a" } } },
        { engineResult: { demo: { mapName: "c4m3_sugarmill_b" } } },
        { engineResult: { demo: { mapName: "c4m4_milltown_b" } } },
      ],
    });
    repo.close();
  });
  it("previews and transactionally purges expired terminal jobs without deleting shared data", () => {
    const repo = new WorkbenchRepository();
    const addAnalysis = (input: {
      key: string;
      path: string;
      demoHash: string;
      resultHash: string;
      serverToken: string;
      rosterToken: string;
      chapter: number;
    }) => {
      const job = repo.enqueue(
        {
          kind: "local",
          path: input.path,
          sha256: input.demoHash,
          bytes: 10,
        },
        input.key,
      );
      expect(repo.claimNext()?.id).toBe(job.id);
      repo.finish(job.id, "succeeded");
      repo.recordJobAnalysis({
        jobId: job.id,
        demoSha256: input.demoHash,
        sourceManifest: { kind: "local" },
        engineResult: {
          demo: {
            mapName: `c4m${input.chapter}_fixture`,
            session: {
              serverToken: input.serverToken,
              rosterToken: input.rosterToken,
              serverCount: input.chapter,
              campaign: "c4",
              chapter: input.chapter,
              evidence: ["fixture"],
            },
          },
          cases: [],
        },
        engineResultSha256: input.resultHash,
      });
      return job;
    };
    const sharedHash = "a".repeat(64);
    const expiredShared = addAnalysis({
      key: "expired-shared",
      path: "/uploads/shared.dem",
      demoHash: sharedHash,
      resultHash: "b".repeat(64),
      serverToken: "server-a",
      rosterToken: "roster-a",
      chapter: 1,
    });
    const retainedShared = addAnalysis({
      key: "retained-shared",
      path: "/uploads/shared.dem",
      demoHash: sharedHash,
      resultHash: "c".repeat(64),
      serverToken: "server-a",
      rosterToken: "roster-a",
      chapter: 2,
    });
    const uniqueHash = "d".repeat(64);
    const expiredUnique = addAnalysis({
      key: "expired-unique",
      path: "/uploads/unique.dem",
      demoHash: uniqueHash,
      resultHash: "e".repeat(64),
      serverToken: "server-b",
      rosterToken: "roster-b",
      chapter: 1,
    });
    const active = repo.enqueue(
      {
        kind: "local",
        path: "/uploads/active.dem",
        sha256: "f".repeat(64),
        bytes: 10,
      },
      "active",
    );
    for (const id of [expiredShared.id, expiredUnique.id, active.id])
      repo.db
        .prepare(
          "UPDATE jobs SET updated_at='2020-01-01T00:00:00.000Z' WHERE id=?",
        )
        .run(id);
    const addCase = (id: string, demoHash: string) => {
      repo.upsertCase({
        id,
        playerKey: id,
        status: "unreviewed",
        score: { status: "insufficient-data" },
      });
      repo.setCasePresentation(id, {
        schemaVersion: 1,
        id,
        alias: id,
        identityLabel: "fixture",
        provenance: { controlledFixture: true, label: "fixture" },
        demos: [
          {
            id: "demo",
            sha256: demoHash,
            mapName: "c4m1_fixture",
            sourceLabel: "fixture",
            quality: { value: null, basis: [] },
            corroboration: "unassociated",
          },
        ],
        evidence: [],
        association: {
          kind: "demo-local-epoch",
          corroboratingDemoCount: 0,
          explanation: "fixture",
        },
        summary: { encounterCount: 0, independentSignalFamilies: [] },
      });
    };
    addCase("case-shared", sharedHash);
    addCase("case-unique", uniqueHash);
    const retainedGameId = repo.getGameIdForJob(retainedShared.id)!;

    const preview = repo.purgeTerminalJobsBefore("2021-01-01T00:00:00.000Z");
    expect(preview).toMatchObject({
      dryRun: true,
      jobs: 2,
      cases: 1,
      games: 1,
      localPaths: ["/uploads/unique.dem"],
      artifactHashes: ["b".repeat(64), "d".repeat(64), "e".repeat(64)],
    });
    expect(repo.getJob(expiredUnique.id)).toBeDefined();

    const purged = repo.purgeTerminalJobsBefore(
      "2021-01-01T00:00:00.000Z",
      false,
    );
    expect(purged).toMatchObject({ ...preview, dryRun: false });
    expect(repo.getJob(expiredShared.id)).toBeUndefined();
    expect(repo.getJob(expiredUnique.id)).toBeUndefined();
    expect(repo.getJob(retainedShared.id)).toBeDefined();
    expect(repo.getJob(active.id)?.state).toBe("queued");
    expect(repo.getCase("case-unique")).toBeUndefined();
    expect(repo.getCase("case-shared")).toBeDefined();
    expect(repo.auditEvents(expiredUnique.id)).toHaveLength(0);
    expect(repo.getGame(retainedGameId)).toMatchObject({
      confidence: "provisional",
      analyses: [{ jobId: retainedShared.id }],
    });
    expect(repo.auditEvents("retention").at(-1)).toMatchObject({
      eventType: "retention.purged",
    });
    repo.close();
  });
});

describe("ContentAddressedStore", () => {
  it("deduplicates and reads bounded ranges", async () => {
    const root = await mkdtemp(join(tmpdir(), "l4dstats-store-"));
    cleanup.push(root);
    const store = new ContentAddressedStore(root),
      data = new TextEncoder().encode("telemetry");
    const first = await store.put(data),
      second = await store.put(data);
    expect(first).toEqual(second);
    expect(first.sha256).toBe(sha256(data));
    expect(
      new TextDecoder().decode(
        await store.read(first.sha256, { start: 1, endExclusive: 4 }),
      ),
    ).toBe("ele");
    expect(await readFile(store.path(first.sha256), "utf8")).toBe("telemetry");
    await expect(
      store.read(first.sha256, { start: 0, endExclusive: 99 }),
    ).rejects.toThrow(RangeError);
    expect(await store.delete(first.sha256)).toBe(true);
    expect(await store.delete(first.sha256)).toBe(false);
  });
});
