import { describe, expect, it } from "vitest";
import {
  fetchHandler,
  isSupportedUploadFilename,
  parseSteamLookup,
  type EdgeEnvironment,
} from "./index.js";
import { openApiDocument } from "./developer-api.js";

function environment(): EdgeEnvironment {
  return {
    ASSETS: {
      async fetch() {
        return new Response("not found", { status: 404 });
      },
    },
    L4DSTATS_ENVIRONMENT: "test",
    TURSO_DATABASE_URL: "libsql://unused",
    TURSO_AUTH_TOKEN: "unused",
    L4DSTATS_PSEUDONYM_KEY: "unused-test-pseudonym-key",
    TEMPORARY_DEMOS: {
      async head() {
        return null;
      },
      async get() {
        throw new Error("unused");
      },
      async put() {
        throw new Error("unused");
      },
      async delete() {},
    },
    DERIVED_ARTIFACTS: {
      async head() {
        return null;
      },
      async get() {
        throw new Error("unused");
      },
      async put() {
        throw new Error("unused");
      },
      async delete() {},
    },
    ANALYSIS_QUEUE: {
      async send() {
        throw new Error("unused");
      },
    },
    ANALYSIS_CONTAINER: {
      getByName() {
        throw new Error("unused");
      },
    },
  };
}

describe("edge dispatcher", () => {
  it("accepts only explicit safe demo and single-stream/archive suffixes", () => {
    for (const filename of [
      "match.dem",
      "match.dem.zip",
      "cedapug-match.zip",
      "match.dem.gz",
      "match.dem.xz",
      "match.dem.bz2",
      "match.dem.zst",
      "MATCH.DEM.ZIP",
    ])
      expect(isSupportedUploadFilename(filename)).toBe(true);
    for (const filename of [
      "",
      "../match.dem",
      "folder/match.dem",
      "match.tar.gz",
      "match.dem.7z",
      "match.dem.zip.exe",
      "match.dem\0.zip",
    ])
      expect(isSupportedUploadFilename(filename)).toBe(false);
  });
  it("accepts only numeric Steam identities and strict profile URLs", () => {
    expect(parseSteamLookup("76561198000000007")).toEqual({
      kind: "id",
      value: "76561198000000007",
    });
    expect(
      parseSteamLookup(
        "https://steamcommunity.com/profiles/76561198000000007/",
      ),
    ).toEqual({ kind: "id", value: "76561198000000007" });
    expect(parseSteamLookup("https://steamcommunity.com/id/coach_7/")).toEqual({
      kind: "vanity",
      value: "coach_7",
    });
    for (const unsafe of [
      "7656119800000000",
      "coach_7",
      "http://steamcommunity.com/id/coach_7",
      "https://evil.example/id/coach_7",
      "https://steamcommunity.com/id/../profiles/76561198000000007",
      "https://steamcommunity.com/id/coach_7?redirect=1",
    ])
      expect(parseSteamLookup(unsafe)).toBeNull();
  });
  it("serves a bounded unauthenticated health response", async () => {
    const response = await fetchHandler(
      new Request("https://example.test/health"),
      environment(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=31536000",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      environment: "test",
    });
  });

  it("serves public API routes without a login gate", async () => {
    const response = await fetchHandler(
      new Request("https://example.test/api/not-a-route"),
      environment(),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves deployed map geometry through the stable API route", async () => {
    const env = environment();
    env.ASSETS = {
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe(
          "/map-geometry/c5m4_quarter.json",
        );
        return new Response('{"schemaVersion":1}', {
          headers: { "content-type": "application/json" },
        });
      },
    };
    const response = await fetchHandler(
      new Request("https://example.test/api/maps/c5m4_quarter/geometry"),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    await expect(response.json()).resolves.toEqual({ schemaVersion: 1 });
  });

  it("rewrites social metadata for stats and player SPA routes", async () => {
    const env = environment();
    const shell = `<!doctype html><html><head>
      <link rel="canonical" href="https://l4dstats.gg/" />
      <meta name="description" content="home" />
      <meta property="og:title" content="home" />
      <meta property="og:description" content="home" />
      <meta property="og:url" content="https://l4dstats.gg/" />
      <meta property="og:image" content="home.webp" />
      <meta property="og:image:alt" content="home" />
      <meta name="twitter:title" content="home" />
      <meta name="twitter:description" content="home" />
      <meta name="twitter:image" content="home.webp" />
      <title>Home</title></head></html>`;
    env.ASSETS = {
      async fetch() {
        return new Response(shell, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    };
    const stats = await (
      await fetchHandler(new Request("https://l4dstats.gg/stats"), env)
    ).text();
    expect(stats).toContain("L4DStats · The archive in numbers");
    expect(stats).toContain("https://l4dstats.gg/art/og-stats.webp");
    expect(stats).toContain('rel="canonical" href="https://l4dstats.gg/stats"');
    const player = await (
      await fetchHandler(
        new Request("https://l4dstats.gg/player/76561198000000007"),
        env,
      )
    ).text();
    expect(player).toContain("Player dossier · L4DStats");
    expect(player).toContain("https://l4dstats.gg/art/og-player.webp");
  });

  it("publishes the bounded authenticated developer contract", async () => {
    const document = openApiDocument("https://developers.l4dstats.gg") as {
      paths: Record<string, unknown>;
      security: unknown[];
    };
    expect(Object.keys(document.paths)).toEqual([
      "/v1/batches",
      "/v1/uploads/{id}",
      "/v1/jobs/{id}",
    ]);
    expect(document.security).toEqual([{ bearerAuth: [] }]);
  });

  it("serves the developer directory index without an index redirect loop", async () => {
    const env = environment();
    env.ASSETS = {
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe("/developers/");
        return new Response(
          "<!doctype html><title>L4DStats Developers</title>",
          {
            headers: { "content-type": "text/html" },
          },
        );
      },
    };
    const response = await fetchHandler(
      new Request("https://developers.l4dstats.gg/"),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.text()).resolves.toContain("L4DStats Developers");
  });

  it("serves a valid developer robots file instead of the SPA fallback", async () => {
    const response = await fetchHandler(
      new Request("https://developers.l4dstats.gg/robots.txt"),
      environment(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("User-agent: *\nAllow: /\n");
  });
});
