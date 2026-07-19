import { describe, expect, it } from "vitest";
import {
  fetchHandler,
  isSupportedUploadFilename,
  type EdgeEnvironment,
} from "./index.js";

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
      "match.zip",
      "match.tar.gz",
      "match.dem.7z",
      "match.dem.zip.exe",
      "match.dem\0.zip",
    ])
      expect(isSupportedUploadFilename(filename)).toBe(false);
  });
  it("serves a bounded unauthenticated health response", async () => {
    const response = await fetchHandler(
      new Request("https://example.test/health"),
      environment(),
    );
    expect(response.status).toBe(200);
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
});
