import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { BackfillState } from "./state.js";
import type { DiscoveredDemo } from "./types.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

function demo(game: string, chapter: number, date: string): DiscoveredDemo {
  const filename = `${game}_c1m${chapter}_map_1700000000.dem.xz`;
  return {
    sourceId: "test",
    sourceItemKey: filename,
    publishedAt: date,
    downloadUrl: `https://demosdl.l4d2center.com/${filename}`,
    filename,
    declaredBytes: null,
    gameHint: game,
    metadata: {},
  };
}

describe("BackfillState", () => {
  it("schedules recent games first and their demos chronologically", async () => {
    const root = await mkdtemp(join(tmpdir(), "l4dstats-backfill-"));
    roots.push(root);
    const state = new BackfillState(join(root, "state.sqlite"));
    state.upsertDiscovered([
      demo("GAMEOLD", 1, "2026-01-01T00:00:00.000Z"),
      demo("GAMENEW", 2, "2026-02-02T00:00:00.000Z"),
      demo("GAMENEW", 1, "2026-02-01T00:00:00.000Z"),
    ]);
    expect(state.pending(3).map((item) => item.sourceItemKey)).toEqual([
      "GAMENEW_c1m1_map_1700000000.dem.xz",
      "GAMENEW_c1m2_map_1700000000.dem.xz",
      "GAMEOLD_c1m1_map_1700000000.dem.xz",
    ]);
    state.close();
  });

  it("waits for source games to settle and never splits one at the demo cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "l4dstats-backfill-"));
    roots.push(root);
    const state = new BackfillState(join(root, "state.sqlite"));
    state.upsertDiscovered([
      demo("GAMESETTLED", 1, "2026-07-20T00:00:00.000Z"),
      demo("GAMESETTLED", 2, "2026-07-20T00:01:00.000Z"),
      demo("GAMELIVE", 1, "2026-07-20T00:55:00.000Z"),
    ]);
    const selected = state.pending(1, 30, new Date("2026-07-20T01:00:00.000Z"));
    expect(selected.map((item) => item.gameHint)).toEqual([
      "GAMESETTLED",
      "GAMESETTLED",
    ]);
    state.close();
  });

  it("does not revive a completed source item during rediscovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "l4dstats-backfill-"));
    roots.push(root);
    const state = new BackfillState(join(root, "state.sqlite"));
    const item = demo("GAMEA", 1, "2026-01-01T00:00:00.000Z");
    state.upsertDiscovered([item]);
    const pending = state.pending(1)[0]!;
    state.start(pending);
    state.complete(pending, {
      resultSha256: "a".repeat(64),
      resultKey: "sha256/aa/a",
      jobId: "job",
    });
    state.upsertDiscovered([item]);
    expect(state.pending(1)).toEqual([]);
    state.close();
  });

  it("requeues failures caused only by the superseded 100 MiB expansion limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "l4dstats-backfill-"));
    roots.push(root);
    const path = join(root, "state.sqlite");
    const state = new BackfillState(path);
    const item = demo("GAMEA", 1, "2026-01-01T00:00:00.000Z");
    state.upsertDiscovered([item]);
    state.close();
    const db = new DatabaseSync(path);
    db.prepare("DELETE FROM backfill_migrations WHERE version=1").run();
    db.prepare(
      `UPDATE source_items SET state='permanent_failure',
       error_detail='expanded demo exceeds byte limit'`,
    ).run();
    db.close();
    const migrated = new BackfillState(path);
    expect(migrated.pending(1)).toHaveLength(1);
    migrated.close();
  });
});
