import { describe, expect, it } from "vitest";
import { fetchHandler, type EdgeEnvironment } from "./index.js";

function environment(): EdgeEnvironment {
  return {
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
});
