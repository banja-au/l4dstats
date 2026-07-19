import { describe, expect, it } from "vitest";
import { scrubAnalyticsValue } from "./analytics";

describe("analytics privacy boundary", () => {
  it("redacts identifiers, credentials, URLs and hashes from error text", () => {
    const value = scrubAnalyticsValue(
      "dev@example.com l4d_live_secret-token " +
        "17384ffd-541e-42b3-acb5-89eb4c0ff82e " +
        "76561198000000007 " +
        "https://example.com/private " +
        "a".repeat(64),
    );
    expect(value).toBe("[email] [api-key] [id] [steam-id] [url] [hash]");
  });
});
