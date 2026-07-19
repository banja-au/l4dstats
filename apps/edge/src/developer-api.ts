import { createClient, type Client } from "@libsql/client/web";

type DeveloperEnvironment = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
};

type UploadResult = { response: Response; jobId?: string };

const DAY_LIMIT = 100;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const UPLOAD_ID = /^[a-f0-9-]{16,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEMO_SUFFIX = /\.dem(?:\.(?:zip|gz|xz|bz2|zst))?$/i;

function db(environment: DeveloperEnvironment): Client {
  return createClient({
    url: environment.TURSO_DATABASE_URL,
    authToken: environment.TURSO_AUTH_TOKEN,
  });
}

async function migrate(client: Client) {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS developer_accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS developer_sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL, FOREIGN KEY(account_id) REFERENCES developer_accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS developer_api_keys (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT,
      revoked_at TEXT, FOREIGN KEY(account_id) REFERENCES developer_accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS developer_daily_usage (
      account_id TEXT NOT NULL, usage_day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(account_id, usage_day)
    );
    CREATE TABLE IF NOT EXISTS developer_request_logs (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, request_id TEXT NOT NULL,
      method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS developer_request_logs_account_created
      ON developer_request_logs(account_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS developer_upload_grants (
      upload_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, filename TEXT NOT NULL,
      sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, expires_at TEXT NOT NULL, job_id TEXT
    );
    CREATE TABLE IF NOT EXISTS developer_auth_limits (
      limiter_key TEXT PRIMARY KEY, window_start TEXT NOT NULL, attempts INTEGER NOT NULL
    );
  `);
}

function json(status: number, body: unknown, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store");
  headers.set(
    "strict-transport-security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return Response.json(body, { status, headers });
}

function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordHash(
  password: string,
  salt: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt).buffer,
      iterations: 310_000,
    },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++)
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Error("application/json is required");
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("JSON object is required");
  return value as Record<string, unknown>;
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function sessionAccount(
  client: Client,
  request: Request,
): Promise<string | null> {
  const token = cookie(request, "l4dstats_dev_session");
  if (!token) return null;
  const result = await client.execute({
    sql: "SELECT account_id FROM developer_sessions WHERE token_hash = ? AND expires_at > ?",
    args: [await sha(token), new Date().toISOString()],
  });
  return (result.rows[0]?.account_id as string | undefined) ?? null;
}

async function apiAccount(
  client: Client,
  request: Request,
): Promise<string | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer l4d_live_")) return null;
  const hash = await sha(authorization.slice(7));
  const result = await client.execute({
    sql: "SELECT account_id, id FROM developer_api_keys WHERE key_hash = ? AND revoked_at IS NULL",
    args: [hash],
  });
  const accountId = result.rows[0]?.account_id as string | undefined;
  if (accountId)
    await client.execute({
      sql: "UPDATE developer_api_keys SET last_used_at = ? WHERE id = ?",
      args: [new Date().toISOString(), result.rows[0]!.id as string],
    });
  return accountId ?? null;
}

async function consume(client: Client, accountId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const result = await client.execute({
    sql: `INSERT INTO developer_daily_usage(account_id, usage_day, requests) VALUES (?, ?, 1)
    ON CONFLICT(account_id, usage_day) DO UPDATE SET requests = requests + 1 WHERE requests < ? RETURNING requests`,
    args: [accountId, day, DAY_LIMIT],
  });
  return result.rows.length === 1;
}

async function allowAuthentication(
  client: Client,
  request: Request,
  email: string,
): Promise<boolean> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = await sha(`${address}|${email}`);
  const now = new Date();
  const cutoff = new Date(now.getTime() - 10 * 60 * 1_000).toISOString();
  const result = await client.execute({
    sql: `INSERT INTO developer_auth_limits(limiter_key, window_start, attempts) VALUES (?, ?, 1)
      ON CONFLICT(limiter_key) DO UPDATE SET
        attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
        window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END
      RETURNING attempts`,
    args: [key, now.toISOString(), cutoff, cutoff],
  });
  return Number(result.rows[0]?.attempts ?? 99) <= 10;
}

async function log(
  client: Client,
  accountId: string,
  request: Request,
  response: Response,
  requestId: string,
) {
  await client.execute({
    sql: "INSERT INTO developer_request_logs(id, account_id, request_id, method, path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      crypto.randomUUID(),
      accountId,
      requestId,
      request.method,
      new URL(request.url).pathname,
      response.status,
      new Date().toISOString(),
    ],
  });
}

export async function handleDeveloperConsole(
  request: Request,
  environment: DeveloperEnvironment,
  clientOverride?: Client,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/developer-api/")) return null;
  const client = clientOverride ?? db(environment);
  await migrate(client);
  try {
    if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request))
      return json(403, { error: "Origin check failed" });
    if (
      request.method === "POST" &&
      url.pathname === "/developer-api/auth/register"
    ) {
      const value = await body(request);
      const email = String(value.email ?? "")
        .trim()
        .toLowerCase();
      const password = String(value.password ?? "");
      if (!(await allowAuthentication(client, request, email)))
        return json(429, { error: "Too many attempts; try again later" });
      if (!EMAIL.test(email) || password.length < 12 || password.length > 128)
        return json(400, {
          error: "Use a valid email and a password of 12–128 characters",
        });
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await client.execute({
          sql: "INSERT INTO developer_accounts(id, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [
            id,
            email,
            btoa(String.fromCharCode(...salt)),
            await passwordHash(password, salt),
            now,
          ],
        });
      } catch {
        return json(409, {
          error: "An account with that email already exists",
        });
      }
      return createSession(client, id);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/developer-api/auth/login"
    ) {
      const value = await body(request);
      const email = String(value.email ?? "")
        .trim()
        .toLowerCase();
      const password = String(value.password ?? "");
      if (!(await allowAuthentication(client, request, email)))
        return json(429, { error: "Too many attempts; try again later" });
      const found = await client.execute({
        sql: "SELECT id, password_salt, password_hash FROM developer_accounts WHERE email = ?",
        args: [email],
      });
      const row = found.rows[0];
      const salt = row
        ? decodeBase64(row.password_salt as string)
        : new Uint8Array(16);
      const calculated = await passwordHash(password.slice(0, 128), salt);
      if (!row || !safeEqual(calculated, row.password_hash as string))
        return json(401, { error: "Invalid email or password" });
      return createSession(client, row.id as string);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/developer-api/auth/logout"
    ) {
      const token = cookie(request, "l4dstats_dev_session");
      if (token)
        await client.execute({
          sql: "DELETE FROM developer_sessions WHERE token_hash = ?",
          args: [await sha(token)],
        });
      return json(
        200,
        { ok: true },
        {
          "set-cookie":
            "l4dstats_dev_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
      );
    }
    const accountId = await sessionAccount(client, request);
    if (!accountId) return json(401, { error: "Sign in required" });
    if (request.method === "GET" && url.pathname === "/developer-api/me") {
      const [account, keys, logs, usage] = await Promise.all([
        client.execute({
          sql: "SELECT email FROM developer_accounts WHERE id = ?",
          args: [accountId],
        }),
        client.execute({
          sql: "SELECT id, key_prefix, name, created_at, last_used_at FROM developer_api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
          args: [accountId],
        }),
        client.execute({
          sql: "SELECT id, request_id, method, path, status, created_at FROM developer_request_logs WHERE account_id = ? ORDER BY created_at DESC LIMIT 50",
          args: [accountId],
        }),
        client.execute({
          sql: "SELECT requests FROM developer_daily_usage WHERE account_id = ? AND usage_day = ?",
          args: [accountId, new Date().toISOString().slice(0, 10)],
        }),
      ]);
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      return json(200, {
        account: {
          id: accountId,
          email: account.rows[0]!.email,
          requestsUsed: Number(usage.rows[0]?.requests ?? 0),
          requestsLimit: DAY_LIMIT,
          resetAt: tomorrow.toISOString(),
        },
        keys: keys.rows.map((row) => ({
          id: row.id,
          prefix: row.key_prefix,
          name: row.name,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
        })),
        logs: logs.rows.map((row) => ({
          id: row.id,
          requestId: row.request_id,
          method: row.method,
          path: row.path,
          status: Number(row.status),
          createdAt: row.created_at,
        })),
      });
    }
    if (request.method === "POST" && url.pathname === "/developer-api/keys") {
      const value = await body(request);
      const name =
        String(value.name ?? "Default")
          .trim()
          .slice(0, 48) || "Default";
      const count = await client.execute({
        sql: "SELECT COUNT(*) AS count FROM developer_api_keys WHERE account_id = ? AND revoked_at IS NULL",
        args: [accountId],
      });
      if (Number(count.rows[0]!.count) >= 5)
        return json(409, { error: "Maximum of five active keys reached" });
      const secret = `l4d_live_${randomToken()}`;
      const prefix = secret.slice(0, 18);
      const id = crypto.randomUUID();
      await client.execute({
        sql: "INSERT INTO developer_api_keys(id, account_id, key_hash, key_prefix, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          id,
          accountId,
          await sha(secret),
          prefix,
          name,
          new Date().toISOString(),
        ],
      });
      return json(201, { id, key: secret, prefix, name });
    }
    if (
      request.method === "DELETE" &&
      /^\/developer-api\/keys\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const id = url.pathname.split("/").at(-1)!;
      const result = await client.execute({
        sql: "UPDATE developer_api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL",
        args: [new Date().toISOString(), id, accountId],
      });
      return result.rowsAffected === 1
        ? json(200, { ok: true })
        : json(404, { error: "API key not found" });
    }
    return json(404, { error: "Not found" });
  } catch (error) {
    return json(400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

async function createSession(
  client: Client,
  accountId: string,
): Promise<Response> {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await client.execute({
    sql: "INSERT INTO developer_sessions(token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [await sha(token), accountId, expires, new Date().toISOString()],
  });
  return json(
    201,
    { ok: true },
    {
      "set-cookie": `l4dstats_dev_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
    },
  );
}

export async function handlePublicDeveloperApi(
  request: Request,
  environment: DeveloperEnvironment,
  performUpload: (request: Request, uploadId: string) => Promise<UploadResult>,
  getJob: (jobId: string) => Promise<Response>,
  clientOverride?: Client,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/")) return null;
  const client = clientOverride ?? db(environment);
  await migrate(client);
  const requestId = crypto.randomUUID();
  const accountId = await apiAccount(client, request);
  if (!accountId)
    return json(401, {
      error: "A valid Bearer API key is required",
      requestId,
    });
  if (!(await consume(client, accountId))) {
    const limited = json(
      429,
      { error: "Daily request limit reached", requestId },
      { "retry-after": secondsUntilTomorrow() },
    );
    await log(client, accountId, request, limited, requestId).catch(
      () => undefined,
    );
    const headers = new Headers(limited.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-ratelimit-limit", String(DAY_LIMIT));
    return new Response(limited.body, { status: limited.status, headers });
  }
  let response: Response;
  try {
    if (request.method === "POST" && url.pathname === "/v1/batches") {
      const value = await body(request);
      const demos = value.demos;
      if (!Array.isArray(demos) || demos.length < 1 || demos.length > 10)
        response = json(400, {
          error: "demos must contain between one and ten uploads",
          requestId,
        });
      else {
        const parsed = demos.map((item) => {
          if (!item || typeof item !== "object") return null;
          const input = item as Record<string, unknown>;
          const filename = String(input.filename ?? "");
          const bytes = Number(input.bytes);
          const digest = String(input.sha256 ?? "");
          return filename &&
            !/[/\\\0]/.test(filename) &&
            DEMO_SUFFIX.test(filename) &&
            Number.isSafeInteger(bytes) &&
            bytes >= 1 &&
            bytes <= 100 * 1024 * 1024 &&
            SHA256.test(digest)
            ? { filename, bytes, digest }
            : null;
        });
        const uploads: Array<{
          id: string;
          filename: string;
          uploadUrl: string;
        }> = [];
        const invalid = parsed.some((item) => !item);
        for (const item of invalid ? [] : parsed) {
          if (!item) continue;
          const id = crypto.randomUUID();
          const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await client.execute({
            sql: "INSERT INTO developer_upload_grants(upload_id, account_id, filename, sha256, bytes, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            args: [
              id,
              accountId,
              item.filename,
              item.digest,
              item.bytes,
              expires,
            ],
          });
          uploads.push({
            id,
            filename: item.filename,
            uploadUrl: `/v1/uploads/${id}`,
          });
        }
        response = invalid
          ? json(400, {
              error:
                "Every demo requires a safe filename, SHA-256, and size up to 100 MiB",
              requestId,
            })
          : json(201, { uploads, requestId });
      }
    } else if (
      request.method === "PUT" &&
      /^\/v1\/uploads\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const uploadId = url.pathname.split("/").at(-1)!;
      const grant = await client.execute({
        sql: "SELECT filename, sha256, bytes FROM developer_upload_grants WHERE upload_id = ? AND account_id = ? AND expires_at > ? AND job_id IS NULL",
        args: [uploadId, accountId, new Date().toISOString()],
      });
      const row = grant.rows[0];
      if (!row || !UPLOAD_ID.test(uploadId))
        response = json(404, {
          error: "Upload grant not found or expired",
          requestId,
        });
      else if (
        request.headers.get("x-content-sha256") !== row.sha256 ||
        Number(request.headers.get("content-length")) !== Number(row.bytes)
      )
        response = json(400, {
          error: "Upload headers do not match the grant",
          requestId,
        });
      else {
        const target = new URL(request.url);
        target.pathname = `/api/uploads/${uploadId}`;
        target.searchParams.set("filename", row.filename as string);
        const result = await performUpload(
          new Request(target, request),
          uploadId,
        );
        response = result.response;
        if (result.jobId)
          await client.execute({
            sql: "UPDATE developer_upload_grants SET job_id = ? WHERE upload_id = ?",
            args: [result.jobId, uploadId],
          });
      }
    } else if (
      request.method === "GET" &&
      /^\/v1\/jobs\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const jobId = url.pathname.split("/").at(-1)!;
      const owned = await client.execute({
        sql: "SELECT 1 FROM developer_upload_grants WHERE account_id = ? AND job_id = ?",
        args: [accountId, jobId],
      });
      response = owned.rows.length
        ? await getJob(jobId)
        : json(404, { error: "Job not found", requestId });
    } else response = json(404, { error: "Not found", requestId });
  } catch (error) {
    response = json(400, {
      error: error instanceof Error ? error.message : "Invalid request",
      requestId,
    });
  }
  await log(client, accountId, request, response, requestId).catch(
    () => undefined,
  );
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-ratelimit-limit", String(DAY_LIMIT));
  return new Response(response.body, { status: response.status, headers });
}

function secondsUntilTomorrow(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return String(Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}

export function openApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "L4DStats API",
      version: "1.0.0",
      description: "Bounded L4D2 demo analysis with complete parser lineage.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/batches": {
        post: {
          summary: "Create up to ten upload grants",
          responses: {
            "201": { description: "Upload grants created" },
            "429": { description: "Daily limit reached" },
          },
        },
      },
      "/v1/uploads/{id}": {
        put: {
          summary: "Upload and enqueue one demo",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "202": { description: "Analysis queued" } },
        },
      },
      "/v1/jobs/{id}": {
        get: {
          summary: "Get job state and full analysis result",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description:
                "Job state; successful jobs include the full versioned parser result",
            },
          },
        },
      },
    },
  };
}
