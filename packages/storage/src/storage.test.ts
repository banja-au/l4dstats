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
});

describe("ContentAddressedStore", () => {
  it("deduplicates and reads bounded ranges", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-store-"));
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
  });
});
