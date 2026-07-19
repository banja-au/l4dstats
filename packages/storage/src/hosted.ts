import { randomUUID } from "node:crypto";

import type { JobState, OperationalMetrics } from "./repository.js";

const SHA256 = /^[a-f0-9]{64}$/;

export interface HostedSource {
  kind: "object";
  bucket: string;
  key: string;
  sha256: string;
  bytes: number;
  filename: string;
}

export interface HostedJob {
  id: string;
  idempotencyKey: string;
  state: JobState;
  source: HostedSource;
  attempt: number;
  progress: number;
  message: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostedAnalysisReference {
  jobId: string;
  demoSha256: string;
  resultKey: string;
  resultSha256: string;
  resultBytes: number;
  createdAt: string;
}

export interface HostedGameReference {
  id: string;
  confidence: "high" | "provisional" | "unassociated";
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  analyses: HostedAnalysisReference[];
}

export interface SqlResult {
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
}

export interface AsyncSqlTransaction {
  execute(sql: string, args?: readonly unknown[]): Promise<SqlResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface AsyncSqlClient {
  execute(sql: string, args?: readonly unknown[]): Promise<SqlResult>;
  transaction(mode: "write"): Promise<AsyncSqlTransaction>;
}

export interface ObjectMetadata {
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

export interface HostedObjectStore {
  head(key: string): Promise<ObjectMetadata | undefined>;
  get(key: string): Promise<Uint8Array>;
  getRange(
    key: string,
    start: number,
    endExclusive: number,
  ): Promise<Uint8Array>;
  put(
    key: string,
    bytes: Uint8Array,
    metadata: { sha256: string; contentType: string },
  ): Promise<ObjectMetadata>;
  delete(key: string): Promise<void>;
}

export const hostedMigrations = [
  `CREATE TABLE IF NOT EXISTS hosted_jobs (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL,
    source_json TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosted_jobs_claim_idx
     ON hosted_jobs(state, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS hosted_audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosted_analyses (
    job_id TEXT PRIMARY KEY REFERENCES hosted_jobs(id),
    demo_sha256 TEXT NOT NULL,
    result_key TEXT NOT NULL,
    result_sha256 TEXT NOT NULL,
    result_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosted_games (
    id TEXT PRIMARY KEY,
    server_token TEXT,
    roster_token TEXT,
    campaign TEXT,
    confidence TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosted_game_demos (
    game_id TEXT NOT NULL REFERENCES hosted_games(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL UNIQUE REFERENCES hosted_jobs(id) ON DELETE CASCADE,
    demo_sha256 TEXT NOT NULL,
    map_name TEXT NOT NULL,
    server_count INTEGER,
    chapter INTEGER,
    PRIMARY KEY(game_id,job_id)
  )`,
  `CREATE INDEX IF NOT EXISTS hosted_game_demos_game_idx
     ON hosted_game_demos(game_id,chapter,server_count)`,
] as const;

function parseJob(row: Record<string, unknown>): HostedJob {
  return {
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    state: row.state as JobState,
    source: JSON.parse(String(row.source_json)) as HostedSource,
    attempt: Number(row.attempt),
    progress: Number(row.progress),
    message: row.message === null ? null : String(row.message),
    leaseOwner: row.lease_owner === null ? null : String(row.lease_owner),
    leaseExpiresAt:
      row.lease_expires_at === null ? null : String(row.lease_expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function iso(date = new Date()): string {
  return date.toISOString();
}

function validateSource(source: HostedSource): void {
  if (!source.bucket.trim() || !source.key.trim())
    throw new Error("hosted source bucket and key are required");
  if (!/^[a-f0-9]{64}$/.test(source.sha256))
    throw new Error("hosted source SHA-256 is invalid");
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 1)
    throw new Error("hosted source byte size is invalid");
  if (
    ![".dem", ".dem.zip", ".dem.gz", ".dem.xz", ".dem.bz2", ".dem.zst"].some(
      (suffix) => source.filename.toLowerCase().endsWith(suffix),
    ) ||
    /[/\\\0]/.test(source.filename)
  )
    throw new Error("hosted source filename is invalid or unsupported");
}

/**
 * Narrow asynchronous coordination store for horizontally separated hosted
 * workers. Large analysis and telemetry payloads deliberately do not belong
 * in this database; they are addressed through HostedObjectStore instead.
 */
export class HostedJobRepository {
  public constructor(private readonly client: AsyncSqlClient) {}

  public async migrate(): Promise<void> {
    for (const statement of hostedMigrations)
      await this.client.execute(statement);
  }

  public async enqueue(
    source: HostedSource,
    idempotencyKey: string,
    at = new Date(),
  ): Promise<HostedJob> {
    validateSource(source);
    if (!idempotencyKey.trim()) throw new Error("idempotency key is required");
    const existing = await this.client.execute(
      "SELECT * FROM hosted_jobs WHERE idempotency_key=?",
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      const job = parseJob(existing.rows[0]);
      if (job.state !== "failed") return job;
      const timestamp = iso(at);
      const revived = await this.client.execute(
        `UPDATE hosted_jobs
         SET state='queued',source_json=?,attempt=0,progress=0,message=NULL,
             lease_owner=NULL,lease_expires_at=NULL,updated_at=?
         WHERE id=? AND state='failed'`,
        [JSON.stringify(source), timestamp, job.id],
      );
      if (revived.rowsAffected === 1) {
        await this.audit(
          "job.requeued",
          job.id,
          { sourceKind: source.kind },
          at,
        );
        return (await this.getJob(job.id))!;
      }
      return (await this.getJob(job.id))!;
    }
    const id = randomUUID();
    const timestamp = iso(at);
    await this.client.execute(
      `INSERT INTO hosted_jobs(
        id,idempotency_key,state,source_json,attempt,progress,message,
        lease_owner,lease_expires_at,created_at,updated_at
      ) VALUES(?,?,?,?,0,0,NULL,NULL,NULL,?,?)`,
      [
        id,
        idempotencyKey,
        "queued",
        JSON.stringify(source),
        timestamp,
        timestamp,
      ],
    );
    await this.audit("job.queued", id, { sourceKind: source.kind }, at);
    return (await this.getJob(id))!;
  }

  public async getJob(id: string): Promise<HostedJob | undefined> {
    const result = await this.client.execute(
      "SELECT * FROM hosted_jobs WHERE id=?",
      [id],
    );
    return result.rows[0] ? parseJob(result.rows[0]) : undefined;
  }

  public async claimNext(input: {
    owner: string;
    leaseMs: number;
    at?: Date;
  }): Promise<HostedJob | undefined> {
    if (!input.owner.trim()) throw new Error("lease owner is required");
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1_000)
      throw new Error("lease duration must be at least one second");
    const at = input.at ?? new Date();
    const timestamp = iso(at);
    const expiry = iso(new Date(at.getTime() + input.leaseMs));
    const transaction = await this.client.transaction("write");
    try {
      const selected = await transaction.execute(
        `SELECT id FROM hosted_jobs
         WHERE state='queued'
            OR (state='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)
         ORDER BY created_at,id LIMIT 1`,
        [timestamp],
      );
      const id = selected.rows[0]?.id;
      if (typeof id !== "string") {
        await transaction.commit();
        return undefined;
      }
      const updated = await transaction.execute(
        `UPDATE hosted_jobs
         SET state='running',attempt=attempt+1,lease_owner=?,lease_expires_at=?,
             message=NULL,updated_at=?
         WHERE id=? AND (
           state='queued'
           OR (state='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)
         )`,
        [input.owner, expiry, timestamp, id, timestamp],
      );
      if (updated.rowsAffected !== 1) {
        await transaction.rollback();
        return undefined;
      }
      await transaction.commit();
      await this.audit("job.started", id, { owner: input.owner }, at);
      return this.getJob(id);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async claim(input: {
    id: string;
    owner: string;
    leaseMs: number;
    at?: Date;
  }): Promise<HostedJob | undefined> {
    if (!input.owner.trim()) throw new Error("lease owner is required");
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1_000)
      throw new Error("lease duration must be at least one second");
    const at = input.at ?? new Date();
    const timestamp = iso(at);
    const result = await this.client.execute(
      `UPDATE hosted_jobs
       SET state='running',attempt=attempt+1,lease_owner=?,lease_expires_at=?,
           message=NULL,updated_at=?
       WHERE id=? AND (
         state='queued'
         OR (state='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)
       )`,
      [
        input.owner,
        iso(new Date(at.getTime() + input.leaseMs)),
        timestamp,
        input.id,
        timestamp,
      ],
    );
    if (result.rowsAffected !== 1) return undefined;
    await this.audit("job.started", input.id, { owner: input.owner }, at);
    return this.getJob(input.id);
  }

  public async renewLease(input: {
    id: string;
    owner: string;
    leaseMs: number;
    at?: Date;
  }): Promise<void> {
    const at = input.at ?? new Date();
    const result = await this.client.execute(
      `UPDATE hosted_jobs SET lease_expires_at=?,updated_at=?
       WHERE id=? AND state='running' AND lease_owner=?`,
      [
        iso(new Date(at.getTime() + input.leaseMs)),
        iso(at),
        input.id,
        input.owner,
      ],
    );
    if (result.rowsAffected !== 1) throw new Error("hosted job lease was lost");
  }

  public async retry(input: {
    id: string;
    owner: string;
    message: string;
    at?: Date;
  }): Promise<HostedJob> {
    const timestamp = iso(input.at);
    const result = await this.client.execute(
      `UPDATE hosted_jobs
       SET state='queued',message=?,lease_owner=NULL,lease_expires_at=NULL,
           updated_at=?
       WHERE id=? AND state='running' AND lease_owner=?`,
      [input.message, timestamp, input.id, input.owner],
    );
    if (result.rowsAffected !== 1) throw new Error("hosted job lease was lost");
    await this.audit("job.retrying", input.id, {
      message: input.message,
    });
    return (await this.getJob(input.id))!;
  }

  public async defer(input: {
    id: string;
    owner: string;
    message: string;
    at?: Date;
  }): Promise<HostedJob> {
    const timestamp = iso(input.at);
    const result = await this.client.execute(
      `UPDATE hosted_jobs
       SET state='queued',attempt=CASE WHEN attempt>0 THEN attempt-1 ELSE 0 END,
           message=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
       WHERE id=? AND state='running' AND lease_owner=?`,
      [input.message, timestamp, input.id, input.owner],
    );
    if (result.rowsAffected !== 1) throw new Error("hosted job lease was lost");
    await this.audit(
      "job.deferred",
      input.id,
      { message: input.message },
      input.at,
    );
    return (await this.getJob(input.id))!;
  }

  public async progress(input: {
    id: string;
    owner: string;
    value: number;
    message: string;
    at?: Date;
  }): Promise<void> {
    if (!Number.isFinite(input.value) || input.value < 0 || input.value > 1)
      throw new Error("progress must be between zero and one");
    const result = await this.client.execute(
      `UPDATE hosted_jobs SET progress=?,message=?,updated_at=?
       WHERE id=? AND state='running' AND lease_owner=?`,
      [input.value, input.message, iso(input.at), input.id, input.owner],
    );
    if (result.rowsAffected !== 1) throw new Error("hosted job lease was lost");
  }

  public async finish(input: {
    id: string;
    owner: string;
    state: "succeeded" | "failed";
    message?: string;
    at?: Date;
  }): Promise<HostedJob> {
    const timestamp = iso(input.at);
    const result = await this.client.execute(
      `UPDATE hosted_jobs
       SET state=?,progress=CASE WHEN ?='succeeded' THEN 1 ELSE progress END,
           message=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
       WHERE id=? AND state='running' AND lease_owner=?`,
      [
        input.state,
        input.state,
        input.message ?? null,
        timestamp,
        input.id,
        input.owner,
      ],
    );
    if (result.rowsAffected !== 1) throw new Error("hosted job lease was lost");
    await this.audit(`job.${input.state}`, input.id, {
      message: input.message ?? null,
    });
    return (await this.getJob(input.id))!;
  }

  public async operationalMetrics(
    at = new Date(),
  ): Promise<OperationalMetrics> {
    const result = await this.client.execute(
      "SELECT state,COUNT(*) AS count FROM hosted_jobs GROUP BY state",
    );
    const jobs: OperationalMetrics["jobs"] = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of result.rows) {
      const state = String(row.state) as JobState;
      if (state in jobs) jobs[state] = Number(row.count);
    }
    const oldest = await this.client.execute(
      "SELECT MIN(created_at) AS created_at FROM hosted_jobs WHERE state='queued'",
    );
    const createdAt = oldest.rows[0]?.created_at;
    return {
      jobs,
      oldestQueuedAgeSeconds:
        typeof createdAt === "string"
          ? Math.max(0, (at.getTime() - Date.parse(createdAt)) / 1_000)
          : null,
    };
  }

  public async recordAnalysis(
    input: Omit<HostedAnalysisReference, "createdAt"> & {
      engineResult?: unknown;
    },
    at = new Date(),
  ): Promise<HostedAnalysisReference> {
    if (
      !SHA256.test(input.demoSha256) ||
      !SHA256.test(input.resultSha256) ||
      !input.resultKey.trim() ||
      !Number.isSafeInteger(input.resultBytes) ||
      input.resultBytes < 1
    )
      throw new Error("hosted analysis reference is invalid");
    const createdAt = iso(at);
    await this.client.execute(
      `INSERT INTO hosted_analyses(
        job_id,demo_sha256,result_key,result_sha256,result_bytes,created_at
      ) VALUES(?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET
        demo_sha256=excluded.demo_sha256,
        result_key=excluded.result_key,
        result_sha256=excluded.result_sha256,
        result_bytes=excluded.result_bytes
      WHERE hosted_analyses.demo_sha256=excluded.demo_sha256
        AND hosted_analyses.result_sha256=excluded.result_sha256`,
      [
        input.jobId,
        input.demoSha256,
        input.resultKey,
        input.resultSha256,
        input.resultBytes,
        createdAt,
      ],
    );
    const stored = await this.getAnalysis(input.jobId);
    if (
      !stored ||
      stored.demoSha256 !== input.demoSha256 ||
      stored.resultSha256 !== input.resultSha256
    )
      throw new Error("hosted analysis conflicts with an accepted artifact");
    await this.audit("job.analysis-persisted", input.jobId, {
      demoSha256: input.demoSha256,
      resultSha256: input.resultSha256,
    });
    if (input.engineResult)
      await this.assignGame({
        jobId: input.jobId,
        demoSha256: input.demoSha256,
        engineResult: input.engineResult,
      });
    return stored;
  }

  private async assignGame(input: {
    jobId: string;
    demoSha256: string;
    engineResult: unknown;
  }): Promise<string> {
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
    const possible =
      serverToken && rosterToken
        ? (
            await this.client.execute(
              `SELECT DISTINCT g.id,g.created_at FROM hosted_games g
           JOIN hosted_game_demos d ON d.game_id=g.id
           WHERE g.server_token=? AND g.roster_token=? AND g.campaign IS ?
             AND (? IS NULL OR d.server_count IS NULL OR ABS(d.server_count-?)<=1)
             AND (? IS NULL OR d.chapter IS NULL OR ABS(d.chapter-?)<=1)
           ORDER BY g.created_at,g.id`,
              [
                serverToken,
                rosterToken,
                campaign,
                serverCount,
                serverCount,
                chapter,
                chapter,
              ],
            )
          ).rows
        : [];
    const candidates: string[] = [];
    for (const candidate of possible) {
      const existing = (
        await this.client.execute(
          "SELECT demo_sha256,server_count,chapter FROM hosted_game_demos WHERE game_id=?",
          [candidate.id],
        )
      ).rows;
      if (
        existing.some((row) => row.demo_sha256 === input.demoSha256) ||
        !existing.some(
          (row) =>
            (serverCount !== null &&
              Number(row.server_count) === serverCount) ||
            (chapter !== null && Number(row.chapter) === chapter),
        )
      )
        candidates.push(String(candidate.id));
    }
    const gameId = candidates[0] ?? randomUUID();
    const timestamp = iso();
    if (!candidates.length)
      await this.client.execute(
        `INSERT INTO hosted_games VALUES(?,?,?,?,?,?,?,?)`,
        [
          gameId,
          serverToken,
          rosterToken,
          campaign,
          serverToken && rosterToken ? "provisional" : "unassociated",
          JSON.stringify(evidence),
          timestamp,
          timestamp,
        ],
      );
    for (const duplicate of candidates.slice(1)) {
      await this.client.execute(
        "UPDATE hosted_game_demos SET game_id=? WHERE game_id=?",
        [gameId, duplicate],
      );
      await this.client.execute("DELETE FROM hosted_games WHERE id=?", [
        duplicate,
      ]);
    }
    await this.client.execute(
      `INSERT INTO hosted_game_demos VALUES(?,?,?,?,?,?)
       ON CONFLICT(job_id) DO NOTHING`,
      [
        gameId,
        input.jobId,
        input.demoSha256,
        String(result.demo?.mapName ?? "unknown"),
        serverCount,
        chapter,
      ],
    );
    const count = Number(
      (
        await this.client.execute(
          "SELECT COUNT(*) AS count FROM hosted_game_demos WHERE game_id=?",
          [gameId],
        )
      ).rows[0]?.count ?? 0,
    );
    await this.client.execute(
      "UPDATE hosted_games SET confidence=?,updated_at=? WHERE id=?",
      [
        serverToken && rosterToken && count > 1
          ? "high"
          : serverToken && rosterToken
            ? "provisional"
            : "unassociated",
        timestamp,
        gameId,
      ],
    );
    return gameId;
  }

  public async assignAnalysisToGame(input: {
    jobId: string;
    demoSha256: string;
    engineResult: unknown;
  }): Promise<string> {
    const existing = await this.getGameIdForJob(input.jobId);
    return existing ?? this.assignGame(input);
  }

  public async getGameIdForJob(jobId: string): Promise<string | null> {
    const row = (
      await this.client.execute(
        "SELECT game_id FROM hosted_game_demos WHERE job_id=?",
        [jobId],
      )
    ).rows[0];
    return row ? String(row.game_id) : null;
  }

  public async getGame(
    gameId: string,
  ): Promise<HostedGameReference | undefined> {
    const game = (
      await this.client.execute("SELECT * FROM hosted_games WHERE id=?", [
        gameId,
      ])
    ).rows[0];
    if (!game) return undefined;
    const rows = (
      await this.client.execute(
        `SELECT a.* FROM hosted_game_demos d JOIN hosted_analyses a ON a.job_id=d.job_id
       WHERE d.game_id=? ORDER BY COALESCE(d.chapter,2147483647),COALESCE(d.server_count,2147483647),d.job_id`,
        [gameId],
      )
    ).rows;
    return {
      id: gameId,
      confidence: String(game.confidence) as HostedGameReference["confidence"],
      evidence: JSON.parse(String(game.evidence_json)) as string[],
      createdAt: String(game.created_at),
      updatedAt: String(game.updated_at),
      analyses: rows.map((row) => ({
        jobId: String(row.job_id),
        demoSha256: String(row.demo_sha256),
        resultKey: String(row.result_key),
        resultSha256: String(row.result_sha256),
        resultBytes: Number(row.result_bytes),
        createdAt: String(row.created_at),
      })),
    };
  }

  public async getAnalysis(
    jobId: string,
  ): Promise<HostedAnalysisReference | undefined> {
    const result = await this.client.execute(
      "SELECT * FROM hosted_analyses WHERE job_id=?",
      [jobId],
    );
    const row = result.rows[0];
    return row
      ? {
          jobId: String(row.job_id),
          demoSha256: String(row.demo_sha256),
          resultKey: String(row.result_key),
          resultSha256: String(row.result_sha256),
          resultBytes: Number(row.result_bytes),
          createdAt: String(row.created_at),
        }
      : undefined;
  }

  private async audit(
    type: string,
    subject: string,
    payload: unknown,
    at = new Date(),
  ): Promise<void> {
    await this.client.execute(
      `INSERT INTO hosted_audit_events(
        id,event_type,subject_id,payload_json,created_at
      ) VALUES(?,?,?,?,?)`,
      [randomUUID(), type, subject, JSON.stringify(payload), iso(at)],
    );
  }
}
