import { describe, expect, it } from "vitest";
import { mergeRatingInputs } from "./projection.js";
import type { RatingPlayerInput } from "./rating.js";

describe("rating input projection", () => {
  it("merges opportunity-normalized observations by exposure", () => {
    const input = (value: number, exposure: number): RatingPlayerInput => ({
      playerId: "player",
      playerAlias: "Player",
      maps: 1,
      survivorSeconds: exposure,
      infectedLives: 0,
      metrics: { survivor_si_kill_rate: { value, exposure } },
    });
    const merged = mergeRatingInputs([input(2, 100), input(4, 300)]);
    expect(merged.maps).toBe(2);
    expect(merged.survivorSeconds).toBe(400);
    expect(merged.metrics.survivor_si_kill_rate).toEqual({
      value: 3.5,
      exposure: 400,
    });
  });

  it("keeps unavailable metrics absent", () => {
    const merged = mergeRatingInputs([
      {
        playerId: "player",
        playerAlias: "Player",
        maps: 1,
        survivorSeconds: 120,
        infectedLives: 0,
        metrics: {},
      },
    ]);
    expect(merged.metrics).toEqual({});
  });
});
