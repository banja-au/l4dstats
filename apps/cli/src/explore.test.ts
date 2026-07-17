import { describe, expect, it } from "vitest";
import { detectorCards, exploreFeatures, parseFeatureRequest } from "./explore";

const unavailable = (reason = "fixture omitted") => ({
  availability: "unavailable" as const,
  reason,
});

describe("feature explorer", () => {
  it("lists versioned detector cards without a score", () => {
    const cards = detectorCards();
    expect(cards.map((card) => card.id)).toEqual([
      "aim-dynamics",
      "fire-cadence-invariant",
      "hidden-alignment",
      "movement-invariant",
    ]);
    expect(JSON.stringify(cards)).not.toMatch(/probability|cheatScore/i);
  });

  it("returns an explicit skip when telemetry is unavailable", () => {
    const result = exploreFeatures(
      parseFeatureRequest({
        detectorId: "aim-dynamics",
        detectorVersion: "1.0.0",
        context: {
          playerEpochId: "fixture:1",
          provenance: {
            demoSha256: "a".repeat(64),
            observationArtifactSha256: "b".repeat(64),
            observationSchemaVersion: 1,
            configSha256: "c".repeat(64),
          },
        },
        input: [
          {
            tick: 1,
            timeSeconds: unavailable(),
            eyeAngles: unavailable(),
            playerPosition: unavailable(),
            targetPosition: unavailable(),
            shot: unavailable(),
            targetVisible: unavailable(),
            targetAudible: unavailable(),
            targetPreviouslyKnown: unavailable(),
          },
        ],
      }),
    );
    expect(result.evidence).toEqual([]);
    expect(result.encounters).toEqual([]);
    expect(result.skipped[0]?.code).toBe("missing-prerequisite");
  });
});
