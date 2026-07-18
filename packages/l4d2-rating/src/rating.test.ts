import { describe, expect, it } from "vitest";
import { rateL4d2Match, type RatingPlayerInput } from "./rating";

const complete = (
  id: string,
  multiplier = 1,
  exposure = 600,
): RatingPlayerInput => ({
  playerId: id,
  playerAlias: id,
  maps: 3,
  survivorSeconds: exposure,
  infectedLives: Math.max(3, exposure / 100),
  metrics: Object.fromEntries(
    [
      "survivor_si_kill_rate",
      "survivor_revive_rate",
      "survivor_clear_rate",
      "survivor_death_rate",
      "survivor_incap_rate",
      "survivor_damage_taken_rate",
      "survivor_tank_damage_rate",
      "survivor_witch_damage_rate",
      "infected_damage_per_life",
      "infected_incaps_per_life",
      "infected_kills_per_life",
      "infected_controls_per_life",
      "infected_pin_seconds_per_control",
      "infected_booms_per_life",
      "infected_pulls_per_life",
      "infected_charges_per_life",
      "infected_pounces_per_life",
      "tank_punches_per_life",
      "tank_throws_per_life",
    ].map((key) => [key, { value: multiplier, exposure }]),
  ) as RatingPlayerInput["metrics"],
});

describe("L4DStats Match Rating v0.2", () => {
  it("is permutation invariant and centers equal players at 1.00", () => {
    const inputs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      complete(id),
    );
    const first = rateL4d2Match(inputs);
    const reversed = rateL4d2Match([...inputs].reverse());
    expect(first.players.every((player) => player.rating === 1)).toBe(true);
    expect(
      Object.fromEntries(
        first.players.map((player) => [player.playerId, player.rating]),
      ),
    ).toEqual(
      Object.fromEntries(
        reversed.players.map((player) => [player.playerId, player.rating]),
      ),
    );
  });

  it("rewards positive metrics, penalizes adverse metrics and caps influence", () => {
    const inputs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      complete(id),
    );
    inputs[0]!.metrics.survivor_si_kill_rate = { value: 4, exposure: 600 };
    inputs[0]!.metrics.survivor_death_rate = { value: 0.1, exposure: 600 };
    const result = rateL4d2Match(inputs);
    expect(result.players[0]!.survivor.score).toBeGreaterThan(1);
    expect(
      result.players.every(
        (player) => (player.rating ?? 0) >= 0.6 && (player.rating ?? 2) <= 1.4,
      ),
    ).toBe(true);
  });

  it("shrinks short exposure and never converts missing metrics to zero", () => {
    const long = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      complete(id),
    );
    long[0]!.metrics.survivor_si_kill_rate = { value: 4, exposure: 600 };
    const short = structuredClone(long);
    short[0]!.metrics.survivor_si_kill_rate = { value: 4, exposure: 30 };
    const longContribution =
      rateL4d2Match(long).players[0]!.survivor.pillars[0]!.metrics[0]!
        .adjustedIndex;
    const shortResult = rateL4d2Match(short).players[0]!;
    const shortContribution =
      shortResult.survivor.pillars[0]!.metrics[0]!.adjustedIndex;
    expect(Math.abs(shortContribution - 1)).toBeLessThan(
      Math.abs(longContribution - 1),
    );
    delete short[0]!.metrics.survivor_revive_rate;
    expect(rateL4d2Match(short).players[0]!.survivor.missingMetrics).toContain(
      "survivor_revive_rate",
    );
  });

  it("treats observed zero-variance metrics as neutral and covered", () => {
    const inputs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      complete(id),
    );
    for (const input of inputs)
      input.metrics.survivor_revive_rate = { value: 0, exposure: 600 };
    const result = rateL4d2Match(inputs);
    expect(
      result.players.every((player) =>
        player.survivor.pillars.some(
          (pillar) =>
            pillar.name === "Rescue" &&
            pillar.metrics.some(
              (metric) =>
                metric.key === "survivor_revive_rate" &&
                metric.adjustedIndex === 1,
            ),
        ),
      ),
    ).toBe(true);
  });

  it("withholds overall rating and MVP when both roles are not eligible", () => {
    const inputs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      complete(id),
    );
    for (const input of inputs) {
      input.infectedLives = 0;
      for (const key of Object.keys(input.metrics))
        if (key.startsWith("infected_") || key.startsWith("tank_"))
          delete input.metrics[key as keyof typeof input.metrics];
    }
    const result = rateL4d2Match(inputs);
    expect(result.players.every((player) => player.rating === null)).toBe(true);
    expect(result.mvp.status).toBe("unavailable");
  });
});
