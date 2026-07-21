import { describe, expect, it } from "vitest";
import type { JobAnalysis } from "./api";
import {
  gameCampaignName,
  orderGameAnalyses,
  parseL4d2MapName,
} from "./campaign-metadata";

const analysis = (
  mapName: string,
  chapter: number | null = null,
): JobAnalysis => ({
  jobId: mapName,
  gameId: "hard-rain",
  demoSha256: mapName.padEnd(64, "0"),
  engineResultSha256: mapName.padEnd(64, "1"),
  engineResult: {
    schemaVersion: 1,
    demo: {
      sha256: mapName.padEnd(64, "0"),
      mapName,
      bytes: 1,
      session: {
        serverToken: null,
        rosterToken: null,
        serverCount: null,
        campaign: "c4",
        chapter,
        evidence: [],
      },
    },
    cases: [],
  },
});

describe("L4D2 campaign metadata", () => {
  it("parses official campaign and chapter metadata from embedded map names", () => {
    expect(parseL4d2MapName("c4m3_sugarmill_b")).toEqual({
      campaignCode: "c4",
      campaignName: "Hard Rain",
      chapter: 3,
      source: "official",
    });
    expect(parseL4d2MapName("maps/C14M2_lighthouse")).toEqual({
      campaignCode: "c14",
      campaignName: "The Last Stand",
      chapter: 2,
      source: "official",
    });
    expect(parseL4d2MapName("hf04_escape")).toEqual({
      campaignCode: "custom:hf",
      campaignName: "Custom campaign (HF)",
      chapter: 4,
      source: "custom",
    });
    expect(parseL4d2MapName("custom_map")).toBeNull();
  });

  it("orders a reversed Hard Rain game by the embedded map ordinal", () => {
    const ordered = orderGameAnalyses([
      analysis("c4m4_milltown_b", 4),
      analysis("c4m3_sugarmill_b", 3),
      analysis("c4m2_sugarmill_a", 2),
      analysis("c4m1_milltown_a", 1),
    ]);

    expect(ordered.map((value) => value.engineResult.demo.mapName)).toEqual([
      "c4m1_milltown_a",
      "c4m2_sugarmill_a",
      "c4m3_sugarmill_b",
      "c4m4_milltown_b",
    ]);
    expect(gameCampaignName(ordered)).toBe("Hard Rain");
  });

  it("uses decoded chapter and then stable input order as safe fallbacks", () => {
    const ordered = orderGameAnalyses([
      analysis("custom_finale", 4),
      analysis("custom_opening", 1),
      analysis("unknown_a"),
      analysis("unknown_b"),
    ]);

    expect(ordered.map((value) => value.jobId)).toEqual([
      "custom_opening",
      "custom_finale",
      "unknown_a",
      "unknown_b",
    ]);
  });
});
