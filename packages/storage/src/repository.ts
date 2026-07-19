import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type ReviewStatus =
  | "unreviewed"
  | "in-review"
  | "needs-context"
  | "resolved";
export type IngestSource =
  | {
      kind: "local";
      path: string;
      sha256: string;
      bytes: number;
      sourceObjectSha256?: string;
      sourceObjectBytes?: number;
      sourceObjectFormat?: string;
    }
  | { kind: "remote"; url: string };

export interface Job {
  id: string;
  idempotencyKey: string;
  state: JobState;
  source: IngestSource;
  attempt: number;
  progress: number;
  message: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseSummary {
  id: string;
  playerKey: string;
  status: ReviewStatus;
  scoreJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewNote {
  id: string;
  caseId: string;
  body: string;
  tick: number | null;
  createdAt: string;
}

export interface CasePresentationV1 {
  schemaVersion: 1;
  id: string;
  alias: string;
  identityLabel: string;
  provenance: {
    controlledFixture: boolean;
    label: string;
  };
  demos: Array<{
    id: string;
    sha256: string;
    mapName: string;
    sourceLabel: string;
    quality: { value: number | null; basis: string[] };
    corroboration: "same-stable-player" | "unassociated";
  }>;
  evidence: Array<{
    id: string;
    family: string;
    title: string;
    tick: number;
    tickRange: { start: number; end: number };
    quality: { value: number; basis: string[] };
    contribution: number | null;
    explanation: string;
    counterevidence: string[];
    limitations: string[];
    demoSha256: string;
    window: { startTick: number; endTick: number; contextSeconds: number };
  }>;
  association:
    | {
        kind: "stable-privacy-token";
        stableToken: string;
        corroboratingDemoCount: number;
        explanation: string;
      }
    | {
        kind: "demo-local-epoch";
        corroboratingDemoCount: 0;
        explanation: string;
      };
  summary: {
    encounterCount: number;
    independentSignalFamilies: string[];
  };
}

export const telemetryLimits = {
  maxQueryTicks: 3_000,
  maxStoredChunkTicks: 600,
  maxStoredChunkBytes: 256 * 1024,
  maxResponseChunks: 16,
  maxResponseBytes: 512 * 1024,
} as const;

export interface TelemetryChunk {
  demoSha256?: string;
  startTick: number;
  endTick: number;
  payload: unknown;
}

export interface GameAnalysis {
  id: string;
  confidence: "provisional" | "high" | "unassociated";
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  analyses: unknown[];
}

export interface PlayerHistory {
  steamId64: string;
  displayName: string | null;
  profileUrl: string;
  updatedAt: string;
  games: Array<{
    id: string;
    confidence: GameAnalysis["confidence"];
    updatedAt: string;
    demos: Array<{
      jobId: string;
      demoSha256: string;
      mapName: string;
      createdAt: string;
    }>;
  }>;
}

export interface RetentionPurgeResult {
  cutoff: string;
  dryRun: boolean;
  jobs: number;
  cases: number;
  games: number;
  localPaths: string[];
  artifactHashes: string[];
}

export interface OperationalMetrics {
  jobs: Record<JobState, number>;
  oldestQueuedAgeSeconds: number | null;
}

export interface PublicStats {
  generatedAt: string;
  totals: {
    demosProcessed: number;
    demosLast24Hours: number;
    demosLast30Days: number;
    gamesProcessed: number;
    signalsIdentified: number;
    averageSignalsPerDemo: number | null;
  };
  players: {
    byGames: Array<{
      displayName: string;
      lookup: string;
      games: number;
      demos: number;
    }>;
    bySignals: Array<{
      displayName: string;
      lookup: string;
      games: number;
      signals: number;
    }>;
    byRating: Array<{
      displayName: string;
      lookup: string;
      games: number;
      rating: number;
    }>;
    ratingMinimumGames: 100;
    ratingAvailability: "available" | "unavailable";
  };
  recentGames: Array<{
    id: string;
    campaign: string | null;
    mapCount: number;
    playerCount: number;
    signals: number;
    processedAt: string;
  }>;
}

const migrations = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
     source_json TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0,
     message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS cases (
     id TEXT PRIMARY KEY, player_key TEXT NOT NULL, status TEXT NOT NULL,
     score_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS notes (
     id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), body TEXT NOT NULL,
     tick INTEGER, created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS audit_events (
     sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, subject_id TEXT NOT NULL,
     payload_json TEXT NOT NULL, created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS telemetry_windows (
     case_id TEXT NOT NULL REFERENCES cases(id), start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL,
     payload_json TEXT NOT NULL, PRIMARY KEY(case_id, start_tick, end_tick)
   );`,
  `CREATE TABLE IF NOT EXISTS case_lineage (
     case_id TEXT PRIMARY KEY REFERENCES cases(id), lineage_json TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS job_analyses (
     job_id TEXT PRIMARY KEY REFERENCES jobs(id), demo_sha256 TEXT NOT NULL,
     source_manifest_json TEXT NOT NULL, engine_result_json TEXT NOT NULL,
     engine_result_sha256 TEXT NOT NULL, created_at TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS case_presentations (
     case_id TEXT PRIMARY KEY REFERENCES cases(id), schema_version INTEGER NOT NULL,
     presentation_json TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS telemetry_windows_v2 (
     case_id TEXT NOT NULL REFERENCES cases(id), demo_sha256 TEXT NOT NULL,
     start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL, payload_json TEXT NOT NULL,
     PRIMARY KEY(case_id,demo_sha256,start_tick,end_tick)
   );
   INSERT OR IGNORE INTO telemetry_windows_v2(case_id,demo_sha256,start_tick,end_tick,payload_json)
     SELECT case_id,'',start_tick,end_tick,payload_json FROM telemetry_windows;`,
  `CREATE TABLE IF NOT EXISTS games (
     id TEXT PRIMARY KEY, server_token TEXT, roster_token TEXT, campaign TEXT,
     confidence TEXT NOT NULL, evidence_json TEXT NOT NULL,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS game_demos (
     game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
     job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id), demo_sha256 TEXT NOT NULL,
     map_name TEXT NOT NULL, server_count INTEGER, chapter INTEGER,
     PRIMARY KEY(game_id,job_id)
   );
   CREATE INDEX IF NOT EXISTS game_demos_game_idx ON game_demos(game_id,chapter,server_count);`,
] as const;

function now(): string {
  return new Date().toISOString();
}
function parseJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    state: row.state as JobState,
    source: JSON.parse(String(row.source_json)) as IngestSource,
    attempt: Number(row.attempt),
    progress: Number(row.progress),
    message: row.message === null ? null : String(row.message),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class WorkbenchRepository {
  public readonly db: DatabaseSync;
  public constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    this.migrate();
  }
  public close(): void {
    this.db.close();
  }
  public isReady(): boolean {
    try {
      return this.db.prepare("SELECT 1 AS ready").get() !== undefined;
    } catch {
      return false;
    }
  }
  public operationalMetrics(at = new Date()): OperationalMetrics {
    const jobs: Record<JobState, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    const rows = this.db
      .prepare("SELECT state,COUNT(*) AS count FROM jobs GROUP BY state")
      .all() as { state: JobState; count: number }[];
    for (const row of rows) {
      if (row.state in jobs) jobs[row.state] = Number(row.count);
    }
    const oldest = this.db
      .prepare(
        "SELECT MIN(created_at) AS created_at FROM jobs WHERE state='queued'",
      )
      .get() as { created_at: string | null };
    return {
      jobs,
      oldestQueuedAgeSeconds:
        oldest.created_at === null
          ? null
          : Math.max(
              0,
              (at.getTime() - new Date(oldest.created_at).getTime()) / 1_000,
            ),
    };
  }
  public publicStats(at = new Date()): PublicStats {
    const rows = this.db
      .prepare(
        `SELECT g.id AS game_id,g.campaign,g.updated_at AS game_updated_at,
              a.job_id,a.created_at,a.engine_result_json
       FROM games g JOIN game_demos d ON d.game_id=g.id
       JOIN job_analyses a ON a.job_id=d.job_id
       ORDER BY a.created_at DESC,a.job_id`,
      )
      .all() as Array<Record<string, unknown>>;
    const day = at.getTime() - 24 * 60 * 60 * 1000;
    const month = at.getTime() - 30 * 24 * 60 * 60 * 1000;
    const players = new Map<
      string,
      {
        displayName: string;
        games: Set<string>;
        demos: number;
        signals: number;
      }
    >();
    const games = new Map<
      string,
      {
        id: string;
        campaign: string | null;
        maps: Set<string>;
        players: Set<string>;
        signals: number;
        processedAt: string;
      }
    >();
    let totalSignals = 0;
    for (const row of rows) {
      const result = JSON.parse(String(row.engine_result_json)) as {
        demo?: {
          mapName?: unknown;
          stats?: {
            players?: Array<{
              alias?: unknown;
              evidenceWindows?: unknown;
              identity?: { displayName?: unknown; steamId64?: unknown } | null;
            }>;
          };
        };
        cases?: Array<{
          evidence?: unknown[];
          presentation?: { evidence?: unknown[] };
        }>;
      };
      const gameId = String(row.game_id);
      const demoPlayers = result.demo?.stats?.players ?? [];
      const demoSignals = (result.cases ?? []).reduce(
        (sum, item) =>
          sum +
          (item.presentation?.evidence?.length ?? item.evidence?.length ?? 0),
        0,
      );
      totalSignals += demoSignals;
      const game = games.get(gameId) ?? {
        id: gameId,
        campaign: row.campaign === null ? null : String(row.campaign),
        maps: new Set<string>(),
        players: new Set<string>(),
        signals: 0,
        processedAt: String(row.created_at),
      };
      game.maps.add(String(result.demo?.mapName ?? "unknown"));
      game.signals += demoSignals;
      if (String(row.created_at) > game.processedAt)
        game.processedAt = String(row.created_at);
      for (const player of demoPlayers) {
        const steamId = player.identity?.steamId64;
        if (typeof steamId !== "string" || !/^7656119\d{10}$/.test(steamId))
          continue;
        const displayName = String(
          player.identity?.displayName ?? player.alias ?? "Unknown player",
        )
          .trim()
          .slice(0, 128);
        const aggregate = players.get(steamId) ?? {
          displayName,
          games: new Set<string>(),
          demos: 0,
          signals: 0,
        };
        aggregate.displayName = displayName || aggregate.displayName;
        aggregate.games.add(gameId);
        aggregate.demos += 1;
        aggregate.signals +=
          typeof player.evidenceWindows === "number"
            ? player.evidenceWindows
            : 0;
        players.set(steamId, aggregate);
        game.players.add(steamId);
      }
      games.set(gameId, game);
    }
    const ranked = [...players.entries()].map(([lookup, value]) => ({
      displayName: value.displayName,
      lookup,
      games: value.games.size,
      demos: value.demos,
      signals: value.signals,
    }));
    const demoTimes = rows.map((row) =>
      new Date(String(row.created_at)).getTime(),
    );
    return {
      generatedAt: at.toISOString(),
      totals: {
        demosProcessed: rows.length,
        demosLast24Hours: demoTimes.filter((value) => value >= day).length,
        demosLast30Days: demoTimes.filter((value) => value >= month).length,
        gamesProcessed: games.size,
        signalsIdentified: totalSignals,
        averageSignalsPerDemo: rows.length ? totalSignals / rows.length : null,
      },
      players: {
        byGames: ranked
          .slice()
          .sort(
            (a, b) =>
              b.games - a.games ||
              b.demos - a.demos ||
              a.displayName.localeCompare(b.displayName),
          )
          .slice(0, 10),
        bySignals: ranked
          .slice()
          .sort(
            (a, b) =>
              b.signals - a.signals ||
              b.games - a.games ||
              a.displayName.localeCompare(b.displayName),
          )
          .slice(0, 10),
        byRating: [],
        ratingMinimumGames: 100,
        ratingAvailability: "unavailable",
      },
      recentGames: [...games.values()]
        .sort((a, b) => b.processedAt.localeCompare(a.processedAt))
        .slice(0, 20)
        .map((game) => ({
          id: game.id,
          campaign: game.campaign,
          mapCount: game.maps.size,
          playerCount: game.players.size,
          signals: game.signals,
          processedAt: game.processedAt,
        })),
    };
  }
  private migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const applied = new Set(
      (
        this.db.prepare("SELECT version FROM schema_migrations").all() as {
          version: number;
        }[]
      ).map((x) => x.version),
    );
    migrations.forEach((sql, index) => {
      const version = index + 1;
      if (applied.has(version)) return;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(sql);
        this.db
          .prepare("INSERT INTO schema_migrations VALUES (?, ?)")
          .run(version, now());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }
  private audit(type: string, subject: string, payload: unknown): void {
    this.db
      .prepare(
        "INSERT INTO audit_events(event_type,subject_id,payload_json,created_at) VALUES(?,?,?,?)",
      )
      .run(type, subject, JSON.stringify(payload), now());
  }
  public enqueue(source: IngestSource, idempotencyKey: string): Job {
    if (!idempotencyKey.trim()) throw new Error("idempotency key is required");
    const existing = this.db
      .prepare("SELECT * FROM jobs WHERE idempotency_key=?")
      .get(idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) return parseJob(existing);
    const id = randomUUID(),
      timestamp = now();
    this.db
      .prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        idempotencyKey,
        "queued",
        JSON.stringify(source),
        0,
        0,
        null,
        timestamp,
        timestamp,
      );
    this.audit("job.queued", id, { sourceKind: source.kind });
    return this.getJob(id)!;
  }
  public getJob(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? parseJob(row) : undefined;
  }
  public claimNext(): Job | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT id FROM jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1",
        )
        .get() as { id: string } | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db
        .prepare(
          "UPDATE jobs SET state='running',attempt=attempt+1,updated_at=? WHERE id=? AND state='queued'",
        )
        .run(now(), row.id);
      this.db.exec("COMMIT");
      this.audit("job.started", row.id, {});
      return this.getJob(row.id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  public progress(id: string, value: number, message: string): Job {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError("progress must be between 0 and 1");
    const result = this.db
      .prepare(
        "UPDATE jobs SET progress=?,message=?,updated_at=? WHERE id=? AND state='running'",
      )
      .run(value, message, now(), id);
    if (result.changes !== 1)
      throw new Error("only running jobs can report progress");
    return this.getJob(id)!;
  }
  public finish(
    id: string,
    state: "succeeded" | "failed",
    message?: string,
  ): Job {
    const result = this.db
      .prepare(
        "UPDATE jobs SET state=?,progress=CASE WHEN ?='succeeded' THEN 1 ELSE progress END,message=?,updated_at=? WHERE id=? AND state='running'",
      )
      .run(state, state, message ?? null, now(), id);
    if (result.changes !== 1) throw new Error("only running jobs can finish");
    this.audit(`job.${state}`, id, { message: message ?? null });
    return this.getJob(id)!;
  }
  public cancel(id: string): Job {
    const result = this.db
      .prepare(
        "UPDATE jobs SET state='cancelled',message='Cancelled by reviewer',updated_at=? WHERE id=? AND state IN ('queued','running')",
      )
      .run(now(), id);
    if (result.changes !== 1)
      throw new Error("job cannot be cancelled from its current state");
    this.audit("job.cancelled", id, {});
    return this.getJob(id)!;
  }
  public retry(id: string): Job {
    const result = this.db
      .prepare(
        "UPDATE jobs SET state='queued',progress=0,message=NULL,updated_at=? WHERE id=? AND state IN ('failed','cancelled')",
      )
      .run(now(), id);
    if (result.changes !== 1)
      throw new Error("only failed or cancelled jobs can be retried");
    this.audit("job.retried", id, {});
    return this.getJob(id)!;
  }
  public recoverStaleRunning(
    maxAgeMs: number,
    options: { at?: Date; maxAttempts?: number } = {},
  ): Job[] {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
      throw new RangeError("stale age must be positive");
    const at = options.at ?? new Date(),
      maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
      throw new RangeError("max attempts must be a positive integer");
    const cutoff = new Date(at.getTime() - maxAgeMs).toISOString();
    const stale = this.db
      .prepare(
        "SELECT id,attempt FROM jobs WHERE state='running' AND updated_at<=? ORDER BY updated_at,id",
      )
      .all(cutoff) as { id: string; attempt: number }[];
    for (const job of stale) {
      const exhausted = job.attempt >= maxAttempts;
      this.db
        .prepare(
          "UPDATE jobs SET state=?,progress=CASE WHEN ? THEN progress ELSE 0 END,message=?,updated_at=? WHERE id=? AND state='running'",
        )
        .run(
          exhausted ? "failed" : "queued",
          exhausted ? 1 : 0,
          exhausted
            ? "Worker lease expired; retry limit reached"
            : "Worker lease expired; queued for retry",
          at.toISOString(),
          job.id,
        );
      this.audit(
        exhausted ? "job.stale-failed" : "job.stale-requeued",
        job.id,
        {
          attempt: job.attempt,
          maxAttempts,
        },
      );
    }
    return stale.map((job) => this.getJob(job.id)!);
  }
  public upsertCase(input: {
    id: string;
    playerKey: string;
    status: ReviewStatus;
    score: unknown;
  }): CaseSummary {
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO cases VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET player_key=excluded.player_key,status=excluded.status,score_json=excluded.score_json,updated_at=excluded.updated_at`,
      )
      .run(
        input.id,
        input.playerKey,
        input.status,
        JSON.stringify(input.score),
        timestamp,
        timestamp,
      );
    this.audit("case.updated", input.id, { status: input.status });
    return this.getCase(input.id)!;
  }
  public getCase(id: string): CaseSummary | undefined {
    const row = this.db.prepare("SELECT * FROM cases WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row
      ? {
          id: String(row.id),
          playerKey: String(row.player_key),
          status: row.status as ReviewStatus,
          scoreJson: String(row.score_json),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        }
      : undefined;
  }
  public updateCaseStatus(id: string, status: ReviewStatus): CaseSummary {
    const allowed: readonly ReviewStatus[] = [
      "unreviewed",
      "in-review",
      "needs-context",
      "resolved",
    ];
    if (!allowed.includes(status))
      throw new RangeError("invalid review status");
    const result = this.db
      .prepare("UPDATE cases SET status=?,updated_at=? WHERE id=?")
      .run(status, now(), id);
    if (result.changes !== 1) throw new Error("case not found");
    this.audit("case.status-changed", id, { status });
    return this.getCase(id)!;
  }
  public listCases(limit = 50, offset = 0): CaseSummary[] {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new RangeError("invalid pagination");
    return (
      this.db
        .prepare(
          "SELECT * FROM cases ORDER BY updated_at DESC,id LIMIT ? OFFSET ?",
        )
        .all(limit, offset) as Record<string, unknown>[]
    ).map((row) => ({
      id: String(row.id),
      playerKey: String(row.player_key),
      status: row.status as ReviewStatus,
      scoreJson: String(row.score_json),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }
  public addNote(
    caseId: string,
    body: string,
    tick: number | null,
  ): ReviewNote {
    if (!body.trim() || body.length > 4000)
      throw new RangeError("note must contain 1-4000 characters");
    if (tick !== null && (!Number.isInteger(tick) || tick < 0))
      throw new RangeError("tick must be a non-negative integer");
    if (!this.getCase(caseId)) throw new Error("case not found");
    const note = {
      id: randomUUID(),
      caseId,
      body: body.trim(),
      tick,
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO notes VALUES(?,?,?,?,?)")
      .run(note.id, note.caseId, note.body, note.tick, note.createdAt);
    this.audit("note.created", caseId, { noteId: note.id, tick });
    return note;
  }
  public listNotes(caseId: string): ReviewNote[] {
    if (!this.getCase(caseId)) throw new Error("case not found");
    return (
      this.db
        .prepare(
          "SELECT id,case_id AS caseId,body,tick,created_at AS createdAt FROM notes WHERE case_id=? ORDER BY created_at,id",
        )
        .all(caseId) as Record<string, unknown>[]
    ).map((row) => ({
      id: String(row.id),
      caseId: String(row.caseId),
      body: String(row.body),
      tick: row.tick === null ? null : Number(row.tick),
      createdAt: String(row.createdAt),
    }));
  }
  public putWindow(
    caseId: string,
    startTick: number,
    endTick: number,
    payload: unknown,
    demoSha256 = "",
  ): void {
    if (
      !Number.isInteger(startTick) ||
      !Number.isInteger(endTick) ||
      startTick < 0 ||
      endTick <= startTick ||
      endTick - startTick > telemetryLimits.maxStoredChunkTicks
    )
      throw new RangeError(
        `stored range must span 1-${telemetryLimits.maxStoredChunkTicks} ticks`,
      );
    const payloadJson = JSON.stringify(payload);
    if (Buffer.byteLength(payloadJson) > telemetryLimits.maxStoredChunkBytes)
      throw new RangeError(
        `stored telemetry chunk exceeds ${telemetryLimits.maxStoredChunkBytes} bytes`,
      );
    this.db
      .prepare("INSERT OR REPLACE INTO telemetry_windows_v2 VALUES(?,?,?,?,?)")
      .run(caseId, demoSha256, startTick, endTick, payloadJson);
  }
  public setCaseLineage(caseId: string, lineage: unknown): void {
    if (!this.getCase(caseId)) throw new Error("case not found");
    this.db
      .prepare(
        "INSERT INTO case_lineage VALUES(?,?) ON CONFLICT(case_id) DO UPDATE SET lineage_json=excluded.lineage_json",
      )
      .run(caseId, JSON.stringify(lineage));
  }
  public getCaseLineage(caseId: string): unknown {
    const row = this.db
      .prepare("SELECT lineage_json FROM case_lineage WHERE case_id=?")
      .get(caseId) as { lineage_json: string } | undefined;
    if (!row) throw new Error("case lineage is unavailable");
    return JSON.parse(row.lineage_json) as unknown;
  }
  public setCasePresentation(
    caseId: string,
    presentation: CasePresentationV1,
  ): void {
    if (!this.getCase(caseId)) throw new Error("case not found");
    if (presentation.schemaVersion !== 1)
      throw new RangeError("unsupported case presentation schema");
    if (presentation.id !== caseId)
      throw new RangeError("case presentation ID does not match case");
    if (
      presentation.association.kind === "demo-local-epoch" &&
      (presentation.association.corroboratingDemoCount !== 0 ||
        presentation.demos.some(
          ({ corroboration }) => corroboration !== "unassociated",
        ))
    )
      throw new RangeError(
        "demo-local epochs cannot claim corroborating demos",
      );
    if (presentation.association.kind === "stable-privacy-token") {
      const token = presentation.association.stableToken;
      if (
        token.trim().length < 8 ||
        /^(STEAM_|\[U:|7656119)/i.test(token.trim())
      )
        throw new RangeError(
          "cross-demo association requires a privacy-preserving stable token",
        );
      const associated = presentation.demos.filter(
        ({ corroboration }) => corroboration === "same-stable-player",
      ).length;
      if (
        presentation.association.corroboratingDemoCount !==
        Math.max(0, associated - 1)
      )
        throw new RangeError("corroborating demo count does not match demos");
    }
    this.db
      .prepare(
        "INSERT INTO case_presentations VALUES(?,?,?) ON CONFLICT(case_id) DO UPDATE SET schema_version=excluded.schema_version,presentation_json=excluded.presentation_json",
      )
      .run(caseId, 1, JSON.stringify(presentation));
  }
  public getCasePresentation(caseId: string): CasePresentationV1 {
    const row = this.db
      .prepare(
        "SELECT presentation_json FROM case_presentations WHERE case_id=?",
      )
      .get(caseId) as { presentation_json: string } | undefined;
    if (!row) throw new Error("case presentation is unavailable");
    return JSON.parse(row.presentation_json) as CasePresentationV1;
  }
  public recordJobAnalysis(input: {
    jobId: string;
    demoSha256: string;
    sourceManifest: unknown;
    engineResult: unknown;
    engineResultSha256: string;
  }): void {
    this.db
      .prepare("INSERT INTO job_analyses VALUES(?,?,?,?,?,?)")
      .run(
        input.jobId,
        input.demoSha256,
        JSON.stringify(input.sourceManifest),
        JSON.stringify(input.engineResult),
        input.engineResultSha256,
        now(),
      );
    this.audit("job.analysis-persisted", input.jobId, {
      demoSha256: input.demoSha256,
      engineResultSha256: input.engineResultSha256,
    });
    this.assignGame(input);
  }

  private assignGame(input: {
    jobId: string;
    demoSha256: string;
    engineResult: unknown;
  }): string {
    const result = input.engineResult as {
      demo?: {
        mapName?: unknown;
        session?: {
          serverToken?: unknown;
          rosterToken?: unknown;
          serverCount?: unknown;
          campaign?: unknown;
          chapter?: unknown;
          evidence?: unknown;
        };
      };
    };
    const session = result.demo?.session;
    const serverToken =
      typeof session?.serverToken === "string" ? session.serverToken : null;
    const rosterToken =
      typeof session?.rosterToken === "string" ? session.rosterToken : null;
    const campaign =
      typeof session?.campaign === "string" ? session.campaign : null;
    const serverCount =
      typeof session?.serverCount === "number" ? session.serverCount : null;
    const chapter =
      typeof session?.chapter === "number" ? session.chapter : null;
    const evidence = Array.isArray(session?.evidence)
      ? session.evidence.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const possibleCandidates =
      serverToken && rosterToken
        ? (this.db
            .prepare(
              `SELECT DISTINCT g.id,g.created_at FROM games g
               JOIN game_demos d ON d.game_id=g.id
               WHERE g.server_token=? AND g.roster_token=? AND g.campaign IS ?
                 AND (? IS NULL OR d.server_count IS NULL OR ABS(d.server_count-?)<=1)
                 AND (? IS NULL OR d.chapter IS NULL OR ABS(d.chapter-?)<=1)
               ORDER BY g.created_at,g.id`,
            )
            .all(
              serverToken,
              rosterToken,
              campaign,
              serverCount,
              serverCount,
              chapter,
              chapter,
            ) as Array<{ id: string; created_at: string }>)
        : [];
    const candidates = possibleCandidates.filter((candidate) => {
      const existing = this.db
        .prepare(
          "SELECT demo_sha256,server_count,chapter FROM game_demos WHERE game_id=?",
        )
        .all(candidate.id) as Array<{
        demo_sha256: string;
        server_count: number | null;
        chapter: number | null;
      }>;
      if (existing.some((row) => row.demo_sha256 === input.demoSha256))
        return true;
      return !existing.some(
        (row) =>
          (serverCount !== null && row.server_count === serverCount) ||
          (chapter !== null && row.chapter === chapter),
      );
    });
    const gameId = candidates[0]?.id ?? randomUUID();
    const timestamp = now();
    if (!candidates.length)
      this.db
        .prepare("INSERT INTO games VALUES(?,?,?,?,?,?,?,?)")
        .run(
          gameId,
          serverToken,
          rosterToken,
          campaign,
          serverToken && rosterToken ? "provisional" : "unassociated",
          JSON.stringify(evidence),
          timestamp,
          timestamp,
        );
    for (const duplicate of candidates.slice(1)) {
      this.db
        .prepare("UPDATE game_demos SET game_id=? WHERE game_id=?")
        .run(gameId, duplicate.id);
      this.db.prepare("DELETE FROM games WHERE id=?").run(duplicate.id);
    }
    this.db
      .prepare("INSERT INTO game_demos VALUES(?,?,?,?,?,?)")
      .run(
        gameId,
        input.jobId,
        input.demoSha256,
        String(result.demo?.mapName ?? "unknown"),
        serverCount,
        chapter,
      );
    const count = Number(
      (
        this.db
          .prepare("SELECT COUNT(*) AS count FROM game_demos WHERE game_id=?")
          .get(gameId) as { count: number }
      ).count,
    );
    this.db
      .prepare("UPDATE games SET confidence=?,updated_at=? WHERE id=?")
      .run(
        serverToken && rosterToken && count > 1
          ? "high"
          : serverToken && rosterToken
            ? "provisional"
            : "unassociated",
        timestamp,
        gameId,
      );
    return gameId;
  }

  public getGameIdForJob(jobId: string): string | null {
    const row = this.db
      .prepare("SELECT game_id FROM game_demos WHERE job_id=?")
      .get(jobId) as { game_id: string } | undefined;
    return row?.game_id ?? null;
  }

  public getGame(gameId: string): GameAnalysis {
    const game = this.db
      .prepare("SELECT * FROM games WHERE id=?")
      .get(gameId) as Record<string, unknown> | undefined;
    if (!game) throw new Error("game not found");
    const rows = this.db
      .prepare(
        `SELECT a.* FROM game_demos d JOIN job_analyses a ON a.job_id=d.job_id
         WHERE d.game_id=? ORDER BY COALESCE(d.chapter,2147483647),COALESCE(d.server_count,2147483647),d.job_id`,
      )
      .all(gameId) as Record<string, unknown>[];
    return {
      id: gameId,
      confidence: game.confidence as GameAnalysis["confidence"],
      evidence: JSON.parse(String(game.evidence_json)) as string[],
      createdAt: String(game.created_at),
      updatedAt: String(game.updated_at),
      analyses: rows.map((row) => ({
        jobId: String(row.job_id),
        demoSha256: String(row.demo_sha256),
        sourceManifest: JSON.parse(String(row.source_manifest_json)) as unknown,
        engineResult: JSON.parse(String(row.engine_result_json)) as unknown,
        engineResultSha256: String(row.engine_result_sha256),
        createdAt: String(row.created_at),
        gameId,
      })),
    };
  }

  public getPlayerHistory(steamId64: string): PlayerHistory | undefined {
    if (!/^7656119\d{10}$/.test(steamId64)) return undefined;
    const rows = this.db
      .prepare(
        `SELECT g.id AS game_id,g.confidence,g.updated_at AS game_updated_at,
                a.job_id,a.demo_sha256,a.engine_result_json,a.created_at
         FROM games g JOIN game_demos d ON d.game_id=g.id
         JOIN job_analyses a ON a.job_id=d.job_id
         ORDER BY g.updated_at DESC,a.created_at,a.job_id`,
      )
      .all() as Array<Record<string, unknown>>;
    let displayName: string | null = null;
    let updatedAt = "";
    const games = new Map<string, PlayerHistory["games"][number]>();
    for (const row of rows) {
      const engineResult = JSON.parse(String(row.engine_result_json)) as {
        demo?: {
          mapName?: unknown;
          stats?: {
            players?: Array<{
              alias?: unknown;
              identity?: { displayName?: unknown; steamId64?: unknown } | null;
            }>;
            spectators?: Array<{ displayName?: unknown; steamId64?: unknown }>;
          };
        };
      };
      const identities = [
        ...(engineResult.demo?.stats?.players ?? []).map((player) => ({
          steamId64: player.identity?.steamId64,
          displayName: player.identity?.displayName ?? player.alias,
        })),
        ...(engineResult.demo?.stats?.spectators ?? []),
      ];
      const identity = identities.find(
        (candidate) => candidate.steamId64 === steamId64,
      );
      if (!identity) continue;
      if (
        typeof identity.displayName === "string" &&
        identity.displayName.trim()
      )
        displayName = identity.displayName.trim().slice(0, 128);
      const gameId = String(row.game_id);
      const game = games.get(gameId) ?? {
        id: gameId,
        confidence: String(row.confidence) as GameAnalysis["confidence"],
        updatedAt: String(row.game_updated_at),
        demos: [],
      };
      game.demos.push({
        jobId: String(row.job_id),
        demoSha256: String(row.demo_sha256),
        mapName: String(engineResult.demo?.mapName ?? "unknown"),
        createdAt: String(row.created_at),
      });
      games.set(gameId, game);
      if (String(row.created_at) > updatedAt)
        updatedAt = String(row.created_at);
    }
    if (!games.size) return undefined;
    return {
      steamId64,
      displayName,
      profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
      updatedAt,
      games: [...games.values()],
    };
  }
  public getJobAnalysis(jobId: string): unknown {
    const row = this.db
      .prepare("SELECT * FROM job_analyses WHERE job_id=?")
      .get(jobId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("job analysis not found");
    return {
      jobId,
      demoSha256: String(row.demo_sha256),
      sourceManifest: JSON.parse(String(row.source_manifest_json)) as unknown,
      engineResult: JSON.parse(String(row.engine_result_json)) as unknown,
      engineResultSha256: String(row.engine_result_sha256),
      gameId: this.getGameIdForJob(jobId),
      createdAt: String(row.created_at),
    };
  }

  public purgeTerminalJobsBefore(
    cutoff: string,
    dryRun = true,
  ): RetentionPurgeResult {
    if (!Number.isFinite(Date.parse(cutoff)))
      throw new RangeError("retention cutoff must be an ISO timestamp");
    const jobs = this.db
      .prepare(
        `SELECT id,source_json FROM jobs
         WHERE state IN ('succeeded','failed','cancelled') AND updated_at < ?
         ORDER BY updated_at,id`,
      )
      .all(cutoff) as Array<{ id: string; source_json: string }>;
    if (!jobs.length)
      return {
        cutoff,
        dryRun,
        jobs: 0,
        cases: 0,
        games: 0,
        localPaths: [],
        artifactHashes: [],
      };
    const jobIds = jobs.map(({ id }) => id);
    const placeholders = jobIds.map(() => "?").join(",");
    const analyses = this.db
      .prepare(
        `SELECT job_id,demo_sha256,engine_result_sha256 FROM job_analyses
         WHERE job_id IN (${placeholders})`,
      )
      .all(...jobIds) as Array<{
      job_id: string;
      demo_sha256: string;
      engine_result_sha256: string;
    }>;
    const removedHashes = new Set(
      analyses.flatMap(({ demo_sha256, engine_result_sha256 }) => [
        demo_sha256,
        engine_result_sha256,
      ]),
    );
    const remainingAnalyses = this.db
      .prepare(
        `SELECT demo_sha256,engine_result_sha256 FROM job_analyses
         WHERE job_id NOT IN (${placeholders})`,
      )
      .all(...jobIds) as Array<{
      demo_sha256: string;
      engine_result_sha256: string;
    }>;
    const remainingHashes = new Set(
      remainingAnalyses.flatMap(({ demo_sha256, engine_result_sha256 }) => [
        demo_sha256,
        engine_result_sha256,
      ]),
    );
    const artifactHashes = [...removedHashes]
      .filter((hash) => !remainingHashes.has(hash))
      .sort();
    const retainedDemoHashes = new Set(
      remainingAnalyses.map(({ demo_sha256 }) => demo_sha256),
    );
    const removedDemoHashes = new Set(
      analyses
        .map(({ demo_sha256 }) => demo_sha256)
        .filter((hash) => !retainedDemoHashes.has(hash)),
    );
    const cases = (
      this.db
        .prepare("SELECT case_id,presentation_json FROM case_presentations")
        .all() as Array<{ case_id: string; presentation_json: string }>
    )
      .filter(({ presentation_json }) => {
        const presentation = JSON.parse(
          presentation_json,
        ) as CasePresentationV1;
        return presentation.demos.some(({ sha256 }) =>
          removedDemoHashes.has(sha256),
        );
      })
      .map(({ case_id }) => case_id)
      .sort();
    const affectedGames = this.db
      .prepare(
        `SELECT DISTINCT game_id FROM game_demos WHERE job_id IN (${placeholders})`,
      )
      .all(...jobIds) as Array<{ game_id: string }>;
    const games = affectedGames.filter(({ game_id }) => {
      const remaining = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM game_demos
           WHERE game_id=? AND job_id NOT IN (${placeholders})`,
        )
        .get(game_id, ...jobIds) as { count: number };
      return Number(remaining.count) === 0;
    }).length;
    const candidatePaths = jobs.flatMap(({ source_json }) => {
      const source = JSON.parse(source_json) as IngestSource;
      return source.kind === "local" ? [source.path] : [];
    });
    const retainedPaths = new Set(
      (
        this.db
          .prepare(
            `SELECT source_json FROM jobs WHERE id NOT IN (${placeholders})`,
          )
          .all(...jobIds) as Array<{ source_json: string }>
      ).flatMap(({ source_json }) => {
        const source = JSON.parse(source_json) as IngestSource;
        return source.kind === "local" ? [source.path] : [];
      }),
    );
    const localPaths = [...new Set(candidatePaths)]
      .filter((path) => !retainedPaths.has(path))
      .sort();
    const result: RetentionPurgeResult = {
      cutoff,
      dryRun,
      jobs: jobs.length,
      cases: cases.length,
      games,
      localPaths,
      artifactHashes,
    };
    if (dryRun) return result;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (cases.length) {
        const casePlaceholders = cases.map(() => "?").join(",");
        for (const table of [
          "notes",
          "telemetry_windows",
          "telemetry_windows_v2",
          "case_lineage",
          "case_presentations",
        ])
          this.db
            .prepare(
              `DELETE FROM ${table} WHERE case_id IN (${casePlaceholders})`,
            )
            .run(...cases);
        this.db
          .prepare(`DELETE FROM cases WHERE id IN (${casePlaceholders})`)
          .run(...cases);
        this.db
          .prepare(
            `DELETE FROM audit_events WHERE subject_id IN (${casePlaceholders})`,
          )
          .run(...cases);
      }
      this.db
        .prepare(
          `DELETE FROM audit_events WHERE subject_id IN (${placeholders})`,
        )
        .run(...jobIds);
      this.db
        .prepare(`DELETE FROM game_demos WHERE job_id IN (${placeholders})`)
        .run(...jobIds);
      this.db
        .prepare(`DELETE FROM job_analyses WHERE job_id IN (${placeholders})`)
        .run(...jobIds);
      this.db
        .prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`)
        .run(...jobIds);
      this.db
        .prepare(
          "DELETE FROM games WHERE id NOT IN (SELECT game_id FROM game_demos)",
        )
        .run();
      for (const { game_id } of affectedGames) {
        const row = this.db
          .prepare(
            `SELECT g.server_token,g.roster_token,COUNT(d.job_id) AS count
             FROM games g LEFT JOIN game_demos d ON d.game_id=g.id
             WHERE g.id=? GROUP BY g.id`,
          )
          .get(game_id) as
          | {
              server_token: string | null;
              roster_token: string | null;
              count: number;
            }
          | undefined;
        if (row)
          this.db
            .prepare("UPDATE games SET confidence=?,updated_at=? WHERE id=?")
            .run(
              row.server_token && row.roster_token && Number(row.count) > 1
                ? "high"
                : row.server_token && row.roster_token
                  ? "provisional"
                  : "unassociated",
              now(),
              game_id,
            );
      }
      this.audit("retention.purged", "retention", {
        cutoff,
        jobs: result.jobs,
        cases: result.cases,
        games: result.games,
        artifacts: result.artifactHashes.length,
        localPaths: result.localPaths.length,
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return result;
  }
  public getWindow(
    caseId: string,
    startTick: number,
    endTick: number,
    maxTicks = telemetryLimits.maxQueryTicks,
    demoSha256?: string,
  ): TelemetryChunk[] {
    if (
      !Number.isInteger(startTick) ||
      !Number.isInteger(endTick) ||
      startTick < 0 ||
      endTick <= startTick ||
      endTick - startTick > maxTicks
    )
      throw new RangeError(`range must span 1-${maxTicks} ticks`);
    const rows = this.db
      .prepare(
        `SELECT demo_sha256,start_tick,end_tick,payload_json FROM telemetry_windows_v2
         WHERE case_id=? AND start_tick < ? AND end_tick > ? ${demoSha256 === undefined ? "" : "AND demo_sha256=?"}
         ORDER BY demo_sha256,start_tick LIMIT ?`,
      )
      .all(
        caseId,
        endTick,
        startTick,
        ...(demoSha256 === undefined ? [] : [demoSha256]),
        telemetryLimits.maxResponseChunks + 1,
      ) as {
      demo_sha256: string;
      start_tick: number;
      end_tick: number;
      payload_json: string;
    }[];
    if (rows.length > telemetryLimits.maxResponseChunks)
      throw new RangeError("telemetry response exceeds the chunk limit");
    let responseBytes = 0;
    const chunks = rows.map((row) => {
      const clippedStart = Math.max(startTick, row.start_tick),
        clippedEnd = Math.min(endTick, row.end_tick),
        payload = clipTelemetry(
          JSON.parse(row.payload_json) as unknown,
          clippedStart,
          clippedEnd,
        ),
        encoded = JSON.stringify(payload);
      responseBytes += Buffer.byteLength(encoded);
      return {
        ...(row.demo_sha256 ? { demoSha256: row.demo_sha256 } : {}),
        startTick: clippedStart,
        endTick: clippedEnd,
        payload,
      };
    });
    if (responseBytes > telemetryLimits.maxResponseBytes)
      throw new RangeError("telemetry response exceeds the byte limit");
    return chunks;
  }
  public auditEvents(subjectId: string): unknown[] {
    return this.db
      .prepare(
        "SELECT sequence,event_type AS eventType,subject_id AS subjectId,payload_json AS payloadJson,created_at AS createdAt FROM audit_events WHERE subject_id=? ORDER BY sequence",
      )
      .all(subjectId) as unknown[];
  }
}

function clipTelemetry(
  value: unknown,
  startTick: number,
  endTick: number,
): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => {
        if (!entry || typeof entry !== "object") return true;
        const tick = (entry as Record<string, unknown>).tick;
        return (
          typeof tick !== "number" || (tick >= startTick && tick < endTick)
        );
      })
      .map((entry) => clipTelemetry(entry, startTick, endTick));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      clipTelemetry(entry, startTick, endTick),
    ]),
  );
}
