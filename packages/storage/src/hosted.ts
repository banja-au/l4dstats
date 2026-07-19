import { randomUUID } from "node:crypto";
import {
  l4dStatsRatingVersion,
  mergeRatingInputs,
  projectRatingInputs,
  rateL4d2Match,
  ratingMetricDefinitions,
  type RatingPlayerInput,
  type RatingProjectionStats,
} from "@l4dstats/l4d2-rating";

import type {
  JobState,
  OperationalMetrics,
  PlayerHistory,
  PublicStats,
} from "./repository.js";

const SHA256 = /^[a-f0-9]{64}$/;

export interface HostedSource {
  kind: "object" | "local-backfill";
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

export interface HostedStatsBackfillReference extends HostedAnalysisReference {
  materializedStatsVersion: string | null;
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
  `CREATE TABLE IF NOT EXISTS hosted_players (
    steam_id64 TEXT PRIMARY KEY,
    display_name TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosted_player_demos (
    steam_id64 TEXT NOT NULL REFERENCES hosted_players(steam_id64) ON DELETE CASCADE,
    game_id TEXT NOT NULL REFERENCES hosted_games(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES hosted_jobs(id) ON DELETE CASCADE,
    demo_sha256 TEXT NOT NULL,
    map_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(steam_id64,job_id)
  )`,
  `CREATE INDEX IF NOT EXISTS hosted_player_demos_player_idx
     ON hosted_player_demos(steam_id64,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS hosted_demo_stats (
    job_id TEXT PRIMARY KEY REFERENCES hosted_jobs(id) ON DELETE CASCADE,
    signal_count INTEGER NOT NULL,
    stats_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosted_player_demo_stats (
    steam_id64 TEXT NOT NULL REFERENCES hosted_players(steam_id64) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES hosted_jobs(id) ON DELETE CASCADE,
    signal_count INTEGER NOT NULL,
    rating_input_json TEXT,
    stats_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(steam_id64,job_id)
  )`,
  `CREATE INDEX IF NOT EXISTS hosted_player_demo_stats_player_idx
     ON hosted_player_demo_stats(steam_id64,created_at DESC)`,
] as const;

const hostedStatsVersion = `hosted-stats-v2:${l4dStatsRatingVersion}`;

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
    ![
      ".dem",
      ".zip",
      ".dem.zip",
      ".dem.gz",
      ".dem.xz",
      ".dem.bz2",
      ".dem.zst",
    ].some((suffix) => source.filename.toLowerCase().endsWith(suffix)) ||
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
    if (input.engineResult) {
      await this.assignGame({
        jobId: input.jobId,
        demoSha256: input.demoSha256,
        engineResult: input.engineResult,
      });
      await this.materializeAnalysisStats(input.jobId, input.engineResult, at);
    }
    return stored;
  }

  public async listAnalysesNeedingStats(
    limit = 100,
  ): Promise<HostedStatsBackfillReference[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new RangeError("stats backfill limit must be between 1 and 1000");
    const rows = (
      await this.client.execute(
        `SELECT a.*,s.stats_version FROM hosted_analyses a
         LEFT JOIN hosted_demo_stats s ON s.job_id=a.job_id
         WHERE s.stats_version IS NULL OR s.stats_version<>?
         ORDER BY a.created_at,a.job_id LIMIT ?`,
        [hostedStatsVersion, limit],
      )
    ).rows;
    return rows.map((row) => ({
      jobId: String(row.job_id),
      demoSha256: String(row.demo_sha256),
      resultKey: String(row.result_key),
      resultSha256: String(row.result_sha256),
      resultBytes: Number(row.result_bytes),
      createdAt: String(row.created_at),
      materializedStatsVersion:
        row.stats_version === null ? null : String(row.stats_version),
    }));
  }

  public async materializeAnalysisStats(
    jobId: string,
    engineResult: unknown,
    at = new Date(),
  ): Promise<void> {
    const result = engineResult as {
      demo?: {
        stats?: RatingProjectionStats & {
          players: Array<
            RatingProjectionStats["players"][number] & {
              evidenceWindows?: unknown;
              identity?: { steamId64?: unknown } | null;
            }
          >;
        };
      };
      cases?: Array<{
        evidence?: unknown[];
        presentation?: { evidence?: unknown[] };
      }>;
    };
    const stats = result.demo?.stats;
    const signalCount = (result.cases ?? []).reduce(
      (sum, item) =>
        sum +
        (item.presentation?.evidence?.length ?? item.evidence?.length ?? 0),
      0,
    );
    const timestamp = iso(at);
    if (!stats) {
      await this.client.execute(
        `INSERT INTO hosted_demo_stats VALUES(?,?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET
           signal_count=excluded.signal_count,
           stats_version=excluded.stats_version,
           created_at=excluded.created_at`,
        [jobId, signalCount, hostedStatsVersion, timestamp],
      );
      return;
    }
    const players = stats.players as Array<
      RatingProjectionStats["players"][number] & {
        evidenceWindows?: unknown;
        identity?: { steamId64?: unknown } | null;
      }
    >;
    const identities = new Map(
      players.flatMap((player) =>
        typeof player.identity?.steamId64 === "string" &&
        /^7656119\d{10}$/.test(player.identity.steamId64)
          ? [[player.id, player.identity.steamId64] as const]
          : [],
      ),
    );
    const ratingInputs = new Map(
      projectRatingInputs([stats], (player) => {
        const steamId64 = identities.get(player.id);
        return steamId64 ? { id: steamId64, alias: player.alias } : undefined;
      }).map((input) => [input.playerId, input]),
    );
    for (const player of players) {
      const steamId64 = identities.get(player.id);
      if (!steamId64) continue;
      const playerSignals =
        typeof player.evidenceWindows === "number" ? player.evidenceWindows : 0;
      await this.client.execute(
        `INSERT INTO hosted_player_demo_stats VALUES(?,?,?,?,?,?)
         ON CONFLICT(steam_id64,job_id) DO UPDATE SET
           signal_count=excluded.signal_count,
           rating_input_json=excluded.rating_input_json,
           stats_version=excluded.stats_version,
           created_at=excluded.created_at`,
        [
          steamId64,
          jobId,
          playerSignals,
          ratingInputs.has(steamId64)
            ? JSON.stringify(ratingInputs.get(steamId64))
            : null,
          hostedStatsVersion,
          timestamp,
        ],
      );
    }
    await this.client.execute(
      `INSERT INTO hosted_demo_stats VALUES(?,?,?,?)
       ON CONFLICT(job_id) DO UPDATE SET
         signal_count=excluded.signal_count,
         stats_version=excluded.stats_version,
         created_at=excluded.created_at`,
      [jobId, signalCount, hostedStatsVersion, timestamp],
    );
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
      await this.client.execute(
        "UPDATE hosted_player_demos SET game_id=? WHERE game_id=?",
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
    await this.indexPlayers({
      gameId,
      jobId: input.jobId,
      demoSha256: input.demoSha256,
      mapName: String(result.demo?.mapName ?? "unknown"),
      engineResult: input.engineResult,
      at: timestamp,
    });
    return gameId;
  }

  private async indexPlayers(input: {
    gameId: string;
    jobId: string;
    demoSha256: string;
    mapName: string;
    engineResult: unknown;
    at: string;
  }): Promise<void> {
    const result = input.engineResult as {
      demo?: {
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
      ...(result.demo?.stats?.players ?? []).map((player) => ({
        steamId64: player.identity?.steamId64,
        displayName: player.identity?.displayName ?? player.alias,
      })),
      ...(result.demo?.stats?.spectators ?? []),
    ];
    const unique = new Map<string, string | null>();
    for (const identity of identities) {
      if (
        typeof identity.steamId64 !== "string" ||
        !/^7656119\d{10}$/.test(identity.steamId64)
      )
        continue;
      const displayName =
        typeof identity.displayName === "string" && identity.displayName.trim()
          ? identity.displayName.trim().slice(0, 128)
          : null;
      unique.set(identity.steamId64, displayName);
    }
    for (const [steamId64, displayName] of unique) {
      await this.client.execute(
        `INSERT INTO hosted_players VALUES(?,?,?)
         ON CONFLICT(steam_id64) DO UPDATE SET
           display_name=COALESCE(excluded.display_name,hosted_players.display_name),
           updated_at=excluded.updated_at`,
        [steamId64, displayName, input.at],
      );
      await this.client.execute(
        `INSERT INTO hosted_player_demos VALUES(?,?,?,?,?,?)
         ON CONFLICT(steam_id64,job_id) DO NOTHING`,
        [
          steamId64,
          input.gameId,
          input.jobId,
          input.demoSha256,
          input.mapName,
          input.at,
        ],
      );
    }
  }

  public async assignAnalysisToGame(input: {
    jobId: string;
    demoSha256: string;
    engineResult: unknown;
  }): Promise<string> {
    const existing = await this.getGameIdForJob(input.jobId);
    if (!existing) {
      const gameId = await this.assignGame(input);
      await this.materializeAnalysisStats(input.jobId, input.engineResult);
      return gameId;
    }
    await this.indexPlayers({
      gameId: existing,
      jobId: input.jobId,
      demoSha256: input.demoSha256,
      mapName: String(
        (input.engineResult as { demo?: { mapName?: unknown } }).demo
          ?.mapName ?? "unknown",
      ),
      engineResult: input.engineResult,
      at: iso(),
    });
    await this.materializeAnalysisStats(input.jobId, input.engineResult);
    return existing;
  }

  public async getPlayerHistory(
    steamId64: string,
  ): Promise<PlayerHistory | undefined> {
    if (!/^7656119\d{10}$/.test(steamId64)) return undefined;
    const player = (
      await this.client.execute(
        "SELECT * FROM hosted_players WHERE steam_id64=?",
        [steamId64],
      )
    ).rows[0];
    if (!player) return undefined;
    const rows = (
      await this.client.execute(
        `SELECT d.*,g.confidence,g.updated_at AS game_updated_at
       FROM hosted_player_demos d JOIN hosted_games g ON g.id=d.game_id
       WHERE d.steam_id64=? ORDER BY g.updated_at DESC,d.created_at,d.job_id`,
        [steamId64],
      )
    ).rows;
    const games = new Map<string, PlayerHistory["games"][number]>();
    for (const row of rows) {
      const id = String(row.game_id);
      const game = games.get(id) ?? {
        id,
        confidence: String(row.confidence) as HostedGameReference["confidence"],
        updatedAt: String(row.game_updated_at),
        demos: [],
      };
      game.demos.push({
        jobId: String(row.job_id),
        demoSha256: String(row.demo_sha256),
        mapName: String(row.map_name),
        createdAt: String(row.created_at),
      });
      games.set(id, game);
    }
    const materializedRows = (
      await this.client.execute(
        `SELECT signal_count,rating_input_json FROM hosted_player_demo_stats
         WHERE steam_id64=? AND stats_version=? ORDER BY created_at,job_id`,
        [steamId64, hostedStatsVersion],
      )
    ).rows;
    const ratingInputs = materializedRows.flatMap((row) =>
      row.rating_input_json === null
        ? []
        : [JSON.parse(String(row.rating_input_json)) as RatingPlayerInput],
    );
    const merged = ratingInputs.length
      ? mergeRatingInputs(ratingInputs)
      : undefined;
    let careerRating: number | null = null;
    if (games.size >= 100 && materializedRows.length === rows.length) {
      const cohortRows = (
        await this.client.execute(
          `SELECT p.steam_id64,p.display_name,d.game_id,s.rating_input_json
           FROM hosted_players p
           JOIN hosted_player_demos d ON d.steam_id64=p.steam_id64
           JOIN hosted_player_demo_stats s
             ON s.steam_id64=d.steam_id64 AND s.job_id=d.job_id
           WHERE s.stats_version=? AND s.rating_input_json IS NOT NULL
           ORDER BY p.steam_id64,d.created_at,d.job_id`,
          [hostedStatsVersion],
        )
      ).rows;
      const cohort = new Map<
        string,
        { alias: string; games: Set<string>; inputs: RatingPlayerInput[] }
      >();
      for (const row of cohortRows) {
        const id = String(row.steam_id64);
        const value = cohort.get(id) ?? {
          alias:
            row.display_name === null
              ? "Unknown player"
              : String(row.display_name),
          games: new Set<string>(),
          inputs: [],
        };
        value.games.add(String(row.game_id));
        value.inputs.push(
          JSON.parse(String(row.rating_input_json)) as RatingPlayerInput,
        );
        cohort.set(id, value);
      }
      const eligible = [...cohort.entries()].flatMap(([id, value]) => {
        if (value.games.size < 100) return [];
        const input = mergeRatingInputs(value.inputs);
        input.playerId = id;
        input.playerAlias = value.alias;
        input.maps = value.games.size;
        return [input];
      });
      if (eligible.length >= 4)
        careerRating =
          rateL4d2Match(eligible).players.find(
            (value) => value.playerId === steamId64,
          )?.rating ?? null;
    }
    return {
      steamId64,
      displayName:
        player.display_name === null ? null : String(player.display_name),
      profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
      updatedAt: String(player.updated_at),
      stats: {
        games: games.size,
        demos: rows.length,
        signals:
          materializedRows.length === rows.length
            ? materializedRows.reduce(
                (sum, row) => sum + Number(row.signal_count),
                0,
              )
            : null,
        materializedDemos: materializedRows.length,
        survivorSeconds: merged?.survivorSeconds ?? null,
        infectedLives: merged?.infectedLives ?? null,
        rating: careerRating,
        ratingMinimumGames: 100,
        ratingModelVersion: l4dStatsRatingVersion,
        metrics: merged
          ? Object.entries(merged.metrics).flatMap(([key, observation]) => {
              if (!observation) return [];
              return [
                {
                  key,
                  label:
                    ratingMetricDefinitions.find((item) => item.key === key)
                      ?.label ?? key,
                  value: observation.value,
                  exposure: observation.exposure,
                },
              ];
            })
          : [],
      },
      games: [...games.values()],
    };
  }

  public async publicStats(at = new Date()): Promise<PublicStats> {
    const cutoff24Hours = new Date(
      at.getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const cutoff30Days = new Date(
      at.getTime() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const totals = (
      await this.client.execute(
        `SELECT COUNT(*) AS demos_processed,
          SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS demos_last_24_hours,
          SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS demos_last_30_days
         FROM hosted_analyses`,
        [cutoff24Hours, cutoff30Days],
      )
    ).rows[0];
    const gameTotal = (
      await this.client.execute("SELECT COUNT(*) AS count FROM hosted_games")
    ).rows[0];
    const materialized = (
      await this.client.execute(
        `SELECT COUNT(*) AS count,COALESCE(SUM(signal_count),0) AS signals
         FROM hosted_demo_stats WHERE stats_version=?`,
        [hostedStatsVersion],
      )
    ).rows[0];
    const demoCount = Number(totals?.demos_processed ?? 0);
    const statsComplete = Number(materialized?.count ?? 0) === demoCount;
    const ranked = (
      await this.client.execute(
        `SELECT p.steam_id64,p.display_name,COUNT(DISTINCT d.game_id) AS games,
                COUNT(*) AS demos
         FROM hosted_players p JOIN hosted_player_demos d ON d.steam_id64=p.steam_id64
         GROUP BY p.steam_id64,p.display_name
         ORDER BY games DESC,demos DESC,p.display_name ASC LIMIT 10`,
      )
    ).rows.map((row) => ({
      displayName:
        row.display_name === null ? "Unknown player" : String(row.display_name),
      lookup: String(row.steam_id64),
      games: Number(row.games),
      demos: Number(row.demos),
    }));
    const signalRanked = statsComplete
      ? (
          await this.client.execute(
            `SELECT p.steam_id64,p.display_name,COUNT(DISTINCT d.game_id) AS games,
                    SUM(s.signal_count) AS signals
             FROM hosted_players p
             JOIN hosted_player_demos d ON d.steam_id64=p.steam_id64
             JOIN hosted_player_demo_stats s
               ON s.steam_id64=d.steam_id64 AND s.job_id=d.job_id
             WHERE s.stats_version=?
             GROUP BY p.steam_id64,p.display_name
             ORDER BY signals DESC,games DESC,p.display_name ASC LIMIT 10`,
            [hostedStatsVersion],
          )
        ).rows.map((row) => ({
          displayName:
            row.display_name === null
              ? "Unknown player"
              : String(row.display_name),
          lookup: String(row.steam_id64),
          games: Number(row.games),
          signals: Number(row.signals),
        }))
      : [];
    const careerRows = statsComplete
      ? (
          await this.client.execute(
            `SELECT p.steam_id64,p.display_name,d.game_id,s.rating_input_json
             FROM hosted_players p
             JOIN hosted_player_demos d ON d.steam_id64=p.steam_id64
             JOIN hosted_player_demo_stats s
               ON s.steam_id64=d.steam_id64 AND s.job_id=d.job_id
             WHERE s.stats_version=? AND s.rating_input_json IS NOT NULL
             ORDER BY p.steam_id64,d.created_at,d.job_id`,
            [hostedStatsVersion],
          )
        ).rows
      : [];
    const careers = new Map<
      string,
      { displayName: string; games: Set<string>; inputs: RatingPlayerInput[] }
    >();
    for (const row of careerRows) {
      const steamId64 = String(row.steam_id64);
      const career = careers.get(steamId64) ?? {
        displayName:
          row.display_name === null
            ? "Unknown player"
            : String(row.display_name),
        games: new Set<string>(),
        inputs: [],
      };
      career.games.add(String(row.game_id));
      career.inputs.push(
        JSON.parse(String(row.rating_input_json)) as RatingPlayerInput,
      );
      careers.set(steamId64, career);
    }
    const eligibleCareerInputs = [...careers.entries()].flatMap(
      ([steamId64, career]) => {
        if (career.games.size < 100) return [];
        const input = mergeRatingInputs(career.inputs);
        input.playerId = steamId64;
        input.playerAlias = career.displayName;
        input.maps = career.games.size;
        return [input];
      },
    );
    const careerRatings =
      eligibleCareerInputs.length >= 4
        ? rateL4d2Match(eligibleCareerInputs).players
        : [];
    const byRating = careerRatings
      .flatMap((rating) => {
        const career = careers.get(rating.playerId);
        return rating.rating !== null && career
          ? [
              {
                displayName: career.displayName,
                lookup: rating.playerId,
                games: career.games.size,
                rating: rating.rating,
              },
            ]
          : [];
      })
      .sort(
        (left, right) =>
          right.rating - left.rating ||
          right.games - left.games ||
          left.displayName.localeCompare(right.displayName),
      )
      .slice(0, 10);
    const recent = (
      await this.client.execute(
        `SELECT g.id,g.campaign,MAX(a.created_at) AS processed_at,
                COUNT(DISTINCT d.map_name) AS map_count,
                COUNT(DISTINCT d.job_id) AS demo_count,
                (SELECT COUNT(DISTINCT pd.steam_id64)
                   FROM hosted_player_demos pd WHERE pd.game_id=g.id) AS player_count,
                COUNT(DISTINCT s.job_id) AS stats_count,
                COALESCE(SUM(s.signal_count),0) AS signals
         FROM hosted_games g
         JOIN hosted_game_demos d ON d.game_id=g.id
         JOIN hosted_analyses a ON a.job_id=d.job_id
         LEFT JOIN hosted_demo_stats s
           ON s.job_id=d.job_id AND s.stats_version=?
         GROUP BY g.id,g.campaign
         ORDER BY processed_at DESC,g.id LIMIT 20`,
        [hostedStatsVersion],
      )
    ).rows;
    return {
      generatedAt: at.toISOString(),
      totals: {
        demosProcessed: demoCount,
        demosLast24Hours: Number(totals?.demos_last_24_hours ?? 0),
        demosLast30Days: Number(totals?.demos_last_30_days ?? 0),
        gamesProcessed: Number(gameTotal?.count ?? 0),
        signalsIdentified: statsComplete
          ? Number(materialized?.signals ?? 0)
          : null,
        averageSignalsPerDemo:
          statsComplete && demoCount
            ? Number(materialized?.signals ?? 0) / demoCount
            : null,
      },
      players: {
        byGames: ranked,
        bySignals: signalRanked,
        byRating,
        ratingMinimumGames: 100,
        ratingAvailability:
          eligibleCareerInputs.length >= 4 ? "available" : "unavailable",
      },
      recentGames: recent.map((row) => ({
        id: String(row.id),
        campaign: row.campaign === null ? null : String(row.campaign),
        mapCount: Number(row.map_count),
        playerCount: Number(row.player_count),
        signals:
          Number(row.stats_count) === Number(row.demo_count)
            ? Number(row.signals)
            : null,
        processedAt: String(row.processed_at),
      })),
    };
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
