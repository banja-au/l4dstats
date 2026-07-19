import { describe, expect, it } from "vitest";
import { importedGameUrls, parseArguments } from "./main.js";

describe("backfill arguments", () => {
  it("accepts explicit concurrency and maximum demo count", () => {
    expect(parseArguments(["--concurrency", "4", "--max-demos", "25"])).toEqual(
      expect.objectContaining({ concurrency: 4, maxDemos: 25 }),
    );
  });

  it("rejects unsafe or missing numeric values", () => {
    expect(() => parseArguments(["--concurrency", "0"])).toThrow(
      /positive integer/,
    );
    expect(() => parseArguments(["--max-demos"])).toThrow(/positive integer/);
  });

  it("prints unique imported game URLs against the configured public host", () => {
    expect(
      importedGameUrls(["game-b", "game-a", "game-b"], {
        PRODUCTION_HOSTNAME: "l4dstats.gg",
      }),
    ).toEqual([
      "https://l4dstats.gg/game/game-a/overview",
      "https://l4dstats.gg/game/game-b/overview",
    ]);
  });
});
