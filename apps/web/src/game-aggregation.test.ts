import { describe, expect, it } from "vitest";
import type { DemoStats, PlayerStats } from "./api";
import { aggregateGamePlayers } from "./game-aggregation";

const player = (
  id: string,
  steamId64: string | undefined,
  overrides: Partial<PlayerStats> = {},
): PlayerStats => ({
  id,
  alias: id,
  identity: steamId64 ? { displayName: id, steamId64 } : null,
  team: 2,
  playerClass: "Survivor",
  sampleCount: 10,
  durationSeconds: 20,
  distanceUnits: 100,
  viewTravelDegrees: 30,
  observedPositionRate: 0.8,
  observedAnglesRate: 0.6,
  weapons: [],
  evidenceWindows: 0,
  ...overrides,
});

const stats = (...players: PlayerStats[]): DemoStats => ({
  durationSeconds: 20,
  playbackTicks: 1_000,
  tickRate: 30,
  playerCount: players.length,
  observationCount: 100,
  eventCount: 10,
  requiredEvents: {},
  decodeIssueCount: 0,
  availability: {
    position: 1,
    eyeAngles: 1,
    team: 1,
    playerClass: 1,
    weapon: 1,
  },
  players,
});

describe("aggregateGamePlayers", () => {
  it("reconciles a legacy anonymous epoch when its entity slot has one identity", () => {
    const named = player("demo:7:9", "76561198000000007", {
      alias: "Known",
    });
    named.identity = {
      displayName: "Known",
      steamId64: "76561198000000007",
      steamProfileUrl: "https://steamcommunity.com/profiles/76561198000000007",
    };
    const anonymous = player("demo:7:8", undefined, {
      alias: "Player DEADBE",
      checkpointInfectedKills: 40,
    });
    const merged = aggregateGamePlayers([stats(anonymous, named)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      alias: "Known",
      checkpointInfectedKills: 40,
      identity: {
        steamId64: "76561198000000007",
        inference: "unique-slot-v1",
      },
    });
  });
  it("merges stable Steam identities and preserves unavailable optionals", () => {
    const result = aggregateGamePlayers([
      stats(player("Alpha old", "76561198000000001", { revives: 2 })),
      stats(
        player("Alpha", "76561198000000001", {
          revives: 3,
        }),
      ),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      alias: "Alpha",
      sampleCount: 20,
      durationSeconds: 40,
      revives: 5,
    });
    expect(result[0]?.highestPounceDamage).toBeUndefined();
    expect(result[0]?.pinSeconds).toBeUndefined();
    expect(result[0]?.killsByWeapon).toBeUndefined();
  });

  it("does not impute an unavailable map contribution as zero", () => {
    const result = aggregateGamePlayers([
      stats(player("Alpha", "76561198000000001", { revives: 2 })),
      stats(player("Alpha", "76561198000000001", { revives: undefined })),
    ]);
    expect(result[0]?.revives).toBeUndefined();
  });

  it("does not merge anonymous epochs across demo boundaries", () => {
    const result = aggregateGamePlayers([
      stats(player("slot-1", undefined)),
      stats(player("slot-1", undefined)),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((player) => player.id)).toEqual(["0:slot-1", "1:slot-1"]);
  });

  it("uses max for best plays and sums additive fields", () => {
    const result = aggregateGamePlayers([
      stats(
        player("Alpha", "76561198000000001", {
          pounces: 2,
          highestPounceDamage: 18,
          killsByWeapon: { rifle: 4 },
        }),
      ),
      stats(
        player("Alpha", "76561198000000001", {
          pounces: 3,
          highestPounceDamage: 25,
          killsByWeapon: { rifle: 2, melee: 1 },
        }),
      ),
    ]);
    expect(result[0]).toMatchObject({
      pounces: 5,
      highestPounceDamage: 25,
      killsByWeapon: { rifle: 6, melee: 1 },
    });
  });
});
