import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleDeveloperConsole,
  handlePublicDeveloperApi,
} from "./developer-api.js";

const clients: ReturnType<typeof createClient>[] = [];
function client() {
  const value = createClient({ url: "file::memory:" });
  clients.push(value);
  return value;
}
afterEach(() => {
  for (const value of clients.splice(0)) value.close();
});

const environment = {
  TURSO_DATABASE_URL: "libsql://unused",
  TURSO_AUTH_TOKEN: "unused",
};

async function register(database: ReturnType<typeof createClient>) {
  const response = await handleDeveloperConsole(
    new Request("https://developers.l4dstats.gg/developer-api/auth/register", {
      method: "POST",
      headers: {
        origin: "https://developers.l4dstats.gg",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "dev@example.com",
        password: "correct horse battery staple",
      }),
    }),
    environment,
    database,
  );
  expect(response?.status).toBe(201);
  return response!.headers.get("set-cookie")!.split(";")[0]!;
}

describe("developer account boundary", () => {
  it("requires exact-origin mutations and stores a hashed password", async () => {
    const database = client();
    const rejected = await handleDeveloperConsole(
      new Request(
        "https://developers.l4dstats.gg/developer-api/auth/register",
        {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: "dev@example.com",
            password: "correct horse battery staple",
          }),
        },
      ),
      environment,
      database,
    );
    expect(rejected?.status).toBe(403);
    await register(database);
    const stored = await database.execute(
      "SELECT email, password_hash FROM developer_accounts",
    );
    expect(stored.rows[0]?.email).toBe("dev@example.com");
    expect(stored.rows[0]?.password_hash).not.toContain("correct horse");
  });

  it("issues a one-time API key and returns account-scoped usage and logs", async () => {
    const database = client();
    const session = await register(database);
    const keyResponse = await handleDeveloperConsole(
      new Request("https://developers.l4dstats.gg/developer-api/keys", {
        method: "POST",
        headers: {
          origin: "https://developers.l4dstats.gg",
          cookie: session,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "CI" }),
      }),
      environment,
      database,
    );
    const key = (await keyResponse!.json()) as { key: string };
    expect(key.key).toMatch(/^l4d_live_/);
    const stored = await database.execute(
      "SELECT key_hash FROM developer_api_keys",
    );
    expect(stored.rows[0]?.key_hash).not.toBe(key.key);

    const batch = await handlePublicDeveloperApi(
      new Request("https://developers.l4dstats.gg/v1/batches", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          demos: [
            {
              filename: "match.dem.zst",
              bytes: 42,
              sha256: "a".repeat(64),
            },
          ],
        }),
      }),
      environment,
      async () => ({ response: new Response(null, { status: 202 }) }),
      async () => new Response(null, { status: 404 }),
      database,
    );
    expect(batch?.status).toBe(201);
    expect(batch?.headers.get("x-ratelimit-limit")).toBe("100");

    const me = await handleDeveloperConsole(
      new Request("https://developers.l4dstats.gg/developer-api/me", {
        headers: { cookie: session },
      }),
      environment,
      database,
    );
    const dashboard = (await me!.json()) as {
      account: { requestsUsed: number };
      logs: Array<{ path: string }>;
    };
    expect(dashboard.account.requestsUsed).toBe(1);
    expect(dashboard.logs[0]?.path).toBe("/v1/batches");
  });

  it("rejects unsafe batch metadata before creating a grant", async () => {
    const database = client();
    const session = await register(database);
    const keyResponse = await handleDeveloperConsole(
      new Request("https://developers.l4dstats.gg/developer-api/keys", {
        method: "POST",
        headers: {
          origin: "https://developers.l4dstats.gg",
          cookie: session,
          "content-type": "application/json",
        },
        body: "{}",
      }),
      environment,
      database,
    );
    const { key } = (await keyResponse!.json()) as { key: string };
    const response = await handlePublicDeveloperApi(
      new Request("https://developers.l4dstats.gg/v1/batches", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          demos: [
            { filename: "../match.dem", bytes: 1, sha256: "a".repeat(64) },
          ],
        }),
      }),
      environment,
      async () => ({ response: new Response(null, { status: 202 }) }),
      async () => new Response(null, { status: 404 }),
      database,
    );
    expect(response?.status).toBe(400);
    const grants = await database.execute(
      "SELECT COUNT(*) AS count FROM developer_upload_grants",
    );
    expect(Number(grants.rows[0]?.count)).toBe(0);
  });

  it("deletes an account and all account-owned operational data", async () => {
    const database = client();
    const session = await register(database);
    const response = await handleDeveloperConsole(
      new Request("https://developers.l4dstats.gg/developer-api/account", {
        method: "DELETE",
        headers: {
          origin: "https://developers.l4dstats.gg",
          cookie: session,
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirm: "DELETE" }),
      }),
      environment,
      database,
    );
    expect(response?.status).toBe(200);
    const accounts = await database.execute(
      "SELECT COUNT(*) AS count FROM developer_accounts",
    );
    const sessions = await database.execute(
      "SELECT COUNT(*) AS count FROM developer_sessions",
    );
    expect(Number(accounts.rows[0]?.count)).toBe(0);
    expect(Number(sessions.rows[0]?.count)).toBe(0);
  });
});
