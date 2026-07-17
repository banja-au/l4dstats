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
  | { kind: "local"; path: string; sha256: string; bytes: number }
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
      createdAt: String(row.created_at),
    };
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
