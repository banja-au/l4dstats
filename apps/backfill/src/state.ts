import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { DiscoveredDemo, PendingDemo } from "./types.js";

type FailureState = "retryable_failure" | "permanent_failure";

export class BackfillState {
  private readonly db: DatabaseSync;

  public constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_items (
        source_id TEXT NOT NULL,
        source_item_key TEXT NOT NULL,
        published_at TEXT NOT NULL,
        download_url TEXT NOT NULL,
        filename TEXT NOT NULL,
        declared_bytes INTEGER,
        game_hint TEXT,
        discovery_metadata_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        source_object_sha256 TEXT,
        source_object_bytes INTEGER,
        demo_sha256 TEXT,
        demo_bytes INTEGER,
        result_sha256 TEXT,
        result_key TEXT,
        turso_job_id TEXT,
        error_code TEXT,
        error_detail TEXT,
        PRIMARY KEY(source_id, source_item_key)
      );
      CREATE INDEX IF NOT EXISTS source_items_pending_idx
        ON source_items(state, next_attempt_at, published_at);
      CREATE INDEX IF NOT EXISTS source_items_game_idx
        ON source_items(source_id, game_hint, published_at);
      CREATE TABLE IF NOT EXISTS source_runs (
        source_id TEXT PRIMARY KEY,
        highest_published_at TEXT,
        last_started_at TEXT,
        last_completed_at TEXT,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS backfill_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    this.applyMigrations();
  }

  private applyMigrations(): void {
    const oldLimitMigration = this.db
      .prepare("SELECT 1 AS applied FROM backfill_migrations WHERE version=1")
      .get();
    if (oldLimitMigration) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `UPDATE source_items
           SET state='discovered',next_attempt_at=NULL,error_code=NULL,error_detail=NULL
           WHERE state='permanent_failure'
             AND error_detail='expanded demo exceeds byte limit'
             AND demo_sha256 IS NULL`,
        )
        .run();
      this.db
        .prepare("INSERT INTO backfill_migrations VALUES(1,?)")
        .run(new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public beginDiscovery(sourceId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO source_runs(source_id,last_started_at)
      VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET last_started_at=excluded.last_started_at,last_error=NULL`,
      )
      .run(sourceId, now);
  }

  public upsertDiscovered(items: DiscoveredDemo[]): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`INSERT INTO source_items(
      source_id,source_item_key,published_at,download_url,filename,declared_bytes,
      game_hint,discovery_metadata_json,first_seen_at,last_seen_at,state
    ) VALUES(?,?,?,?,?,?,?,?,?,?, 'discovered')
    ON CONFLICT(source_id,source_item_key) DO UPDATE SET
      published_at=excluded.published_at,download_url=excluded.download_url,
      filename=excluded.filename,declared_bytes=excluded.declared_bytes,
      game_hint=excluded.game_hint,discovery_metadata_json=excluded.discovery_metadata_json,
      last_seen_at=excluded.last_seen_at`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of items)
        statement.run(
          item.sourceId,
          item.sourceItemKey,
          item.publishedAt,
          item.downloadUrl,
          item.filename,
          item.declaredBytes,
          item.gameHint,
          JSON.stringify(item.metadata),
          now,
          now,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public completeDiscovery(sourceId: string, highest: string | null): void {
    this.db
      .prepare(
        `UPDATE source_runs SET highest_published_at=?,last_completed_at=?,last_error=NULL WHERE source_id=?`,
      )
      .run(highest, new Date().toISOString(), sourceId);
  }

  public failDiscovery(sourceId: string, detail: string): void {
    this.db
      .prepare("UPDATE source_runs SET last_error=? WHERE source_id=?")
      .run(detail.slice(0, 2_000), sourceId);
  }

  /** Select settled source games atomically; never cut a game at the demo limit. */
  public pending(
    limit: number,
    settleMinutes = 0,
    minimumChapter = 1,
    at = new Date(),
  ): PendingDemo[] {
    const cutoff = new Date(
      at.getTime() - settleMinutes * 60_000,
    ).toISOString();
    const rows = this.db
      .prepare(
        `WITH group_metrics AS (
          SELECT source_id,game_hint,
            MAX(published_at) AS game_recency,
            MAX(CAST(json_extract(discovery_metadata_json,'$.chapterHint') AS INTEGER)) AS max_chapter,
            COUNT(DISTINCT json_extract(discovery_metadata_json,'$.mapKey')) AS distinct_maps
          FROM source_items GROUP BY source_id,game_hint
        ), eligible AS (
          SELECT i.*,m.game_recency,m.max_chapter,m.distinct_maps
          FROM source_items i JOIN group_metrics m
            ON m.source_id=i.source_id AND m.game_hint IS i.game_hint
          WHERE i.state NOT IN ('complete','permanent_failure')
            AND (i.next_attempt_at IS NULL OR i.next_attempt_at<=?)
            AND m.game_recency<=?
            AND (m.max_chapter>=? OR (m.max_chapter IS NULL AND m.distinct_maps>=?))
        )
        SELECT * FROM eligible
        ORDER BY game_recency DESC,source_id,game_hint,published_at ASC,source_item_key`,
      )
      .all(at.toISOString(), cutoff, minimumChapter, minimumChapter) as Record<
      string,
      unknown
    >[];
    const pending = rows.map((row) => ({
      sourceId: String(row.source_id),
      sourceItemKey: String(row.source_item_key),
      publishedAt: String(row.published_at),
      downloadUrl: String(row.download_url),
      filename: String(row.filename),
      declaredBytes:
        row.declared_bytes === null ? null : Number(row.declared_bytes),
      gameHint: row.game_hint === null ? null : String(row.game_hint),
      metadata: JSON.parse(String(row.discovery_metadata_json)) as Record<
        string,
        unknown
      >,
      attempts: Number(row.attempts),
    }));
    const groups = new Map<string, PendingDemo[]>();
    for (const item of pending) {
      const key = `${item.sourceId}:${item.gameHint ?? item.sourceItemKey}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    const selected: PendingDemo[] = [];
    for (const group of groups.values()) {
      if (selected.length > 0 && selected.length + group.length > limit)
        continue;
      selected.push(...group);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  public completedJobIdsForGroup(
    sourceId: string,
    gameHint: string,
  ): string[] | undefined {
    const rows = this.db
      .prepare(
        `SELECT state,turso_job_id FROM source_items
         WHERE source_id=? AND game_hint=? ORDER BY published_at,source_item_key`,
      )
      .all(sourceId, gameHint) as Array<Record<string, unknown>>;
    if (
      rows.length === 0 ||
      rows.some((row) => row.state !== "complete" || !row.turso_job_id)
    )
      return undefined;
    return rows.map((row) => String(row.turso_job_id));
  }

  public start(item: PendingDemo): void {
    this.db
      .prepare(
        `UPDATE source_items SET state='processing',attempts=attempts+1,
      next_attempt_at=NULL,error_code=NULL,error_detail=NULL WHERE source_id=? AND source_item_key=?`,
      )
      .run(item.sourceId, item.sourceItemKey);
  }

  public recordSource(item: PendingDemo, hash: string, bytes: number): void {
    this.db
      .prepare(
        `UPDATE source_items SET source_object_sha256=?,source_object_bytes=?
      WHERE source_id=? AND source_item_key=?`,
      )
      .run(hash, bytes, item.sourceId, item.sourceItemKey);
  }

  public recordDemo(item: PendingDemo, hash: string, bytes: number): void {
    this.db
      .prepare(
        `UPDATE source_items SET demo_sha256=?,demo_bytes=?
      WHERE source_id=? AND source_item_key=?`,
      )
      .run(hash, bytes, item.sourceId, item.sourceItemKey);
  }

  public complete(
    item: PendingDemo,
    result: {
      resultSha256: string;
      resultKey: string;
      jobId: string;
      gameId?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE source_items SET state='complete',result_sha256=?,result_key=?,
      turso_job_id=?,next_attempt_at=NULL,error_code=NULL,error_detail=NULL
      WHERE source_id=? AND source_item_key=?`,
      )
      .run(
        result.resultSha256,
        result.resultKey,
        result.jobId,
        item.sourceId,
        item.sourceItemKey,
      );
  }

  public fail(
    item: PendingDemo,
    state: FailureState,
    code: string,
    detail: string,
  ): void {
    const delayMinutes = Math.min(24 * 60, 2 ** Math.min(item.attempts, 10));
    const next =
      state === "retryable_failure"
        ? new Date(Date.now() + delayMinutes * 60_000).toISOString()
        : null;
    this.db
      .prepare(
        `UPDATE source_items SET state=?,next_attempt_at=?,error_code=?,error_detail=?
      WHERE source_id=? AND source_item_key=?`,
      )
      .run(
        state,
        next,
        code,
        detail.slice(0, 2_000),
        item.sourceId,
        item.sourceItemKey,
      );
  }

  public close(): void {
    this.db.close();
  }
}
