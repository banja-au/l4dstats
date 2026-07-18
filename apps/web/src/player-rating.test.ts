import { describe, expect, it } from "vitest";
import type { DemoStats, PlayerStats } from "./api";
import { aggregateGamePlayers } from "./game-aggregation";
import { rateGamePlayers } from "./player-rating";

const player = (id: string): PlayerStats => ({
  id,
  alias: id,
  identity: { displayName: id, steamId64: `7656119800000000${id}` },
  team: null,
  playerClass: null,
  sampleCount: 100,
  durationSeconds: 300,
  distanceUnits: 0,
  viewTravelDegrees: 0,
  observedPositionRate: 1,
  observedAnglesRate: 1,
  weapons: [],
  evidenceWindows: 0,
});

const demo = (): DemoStats => {
  const players = Array.from({ length: 8 }, (_, index) =>
    player(String(index)),
  );
  const summary = (index: number, side: "Survivor" | "Infected") => ({
    sampleCount: 100,
    durationSeconds: 300,
    distanceUnits: 0,
    viewTravelDegrees: 0,
    observedPositionRate: 1,
    observedAnglesRate: 1,
    observedTeamRate: 1,
    observedClassRate: 1,
    observedWeaponRate: 1,
    weapons: [],
    survivorDeaths: side === "Survivor" ? index % 2 : 0,
    infectedDeaths: 1,
    specialInfectedKills: 5 + index,
    headshotKills: 0,
    checkpointInfectedKills: 50 + index,
    revives: 2,
    survivorIncaps: 1,
    specialIncaps: 1 + (index % 3),
    pounces: 1,
    pinSeconds: 2 + index,
    ghostSeconds: 4,
    observedHealthLost: 10,
    killsByWeapon: {},
    killsByInfectedClass: {},
    infectedClasses: side === "Infected" ? ["Hunter"] : [],
  });
  const halves = ["first", "second"] as const;
  return {
    durationSeconds: 600,
    playbackTicks: 18_000,
    tickRate: 30,
    playerCount: 8,
    observationCount: 800,
    eventCount: 0,
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
    competitive: {
      derivationVersion: 6,
      rosters: [],
      halves: halves.map((id, halfIndex) => ({
        id,
        secondHalf: halfIndex === 1,
        tickRange: { start: halfIndex * 9000, end: (halfIndex + 1) * 9000 - 1 },
        survivorPlayerIds: players
          .slice(halfIndex * 4, halfIndex * 4 + 4)
          .map((value) => value.id),
        infectedPlayerIds: players
          .slice((1 - halfIndex) * 4, (1 - halfIndex) * 4 + 4)
          .map((value) => value.id),
        players: players.map((value, index) => {
          const side =
            index >= halfIndex * 4 && index < halfIndex * 4 + 4
              ? "Survivor"
              : "Infected";
          return {
            playerId: value.id,
            side,
            counterDeltas: {
              m_checkpointDamageTaken: 20 + index,
              m_checkpointDamageToTank: 50 + index,
              m_checkpointDamageToWitch: 5,
              m_checkpointPZHunterDamage: 30 + index,
              m_checkpointPZSmokerDamage: 0,
              m_checkpointPZBoomerDamage: 0,
              m_checkpointPZJockeyDamage: 0,
              m_checkpointPZSpitterDamage: 0,
              m_checkpointPZChargerDamage: 0,
              m_checkpointPZKills: index % 2,
              m_checkpointPZBombed: 1,
              m_checkpointPZPulled: 1,
              m_checkpointPZNumChargeVictims: 1,
              m_checkpointPZTankPunches: 1,
              m_checkpointPZTankThrows: 1,
            },
            observedCounters: [
              "m_checkpointDamageTaken",
              "m_checkpointDamageToTank",
              "m_checkpointDamageToWitch",
              "m_checkpointPZHunterDamage",
              "m_checkpointPZSmokerDamage",
              "m_checkpointPZBoomerDamage",
              "m_checkpointPZJockeyDamage",
              "m_checkpointPZSpitterDamage",
              "m_checkpointPZChargerDamage",
              "m_checkpointPZKills",
              "m_checkpointPZBombed",
              "m_checkpointPZPulled",
              "m_checkpointPZNumChargeVictims",
              "m_checkpointPZTankPunches",
              "m_checkpointPZTankThrows",
            ],
            summary: summary(index, side),
          };
        }),
      })),
      infectedLives: players.flatMap((value, index) =>
        [0, 1, 2].map((life) => ({
          id: `${value.id}-${life}`,
          playerId: value.id,
          playerAlias: value.alias,
          infectedClass: life === 2 ? "Tank" : "Hunter",
          tickRange: {
            start: index < 4 ? 9100 + life * 100 : 100 + life * 100,
            end: index < 4 ? 9150 + life * 100 : 150 + life * 100,
          },
          durationSeconds: 2,
          startReason:
            life === 2 ? ("tank-control" as const) : ("spawn" as const),
          endReason: "death" as const,
          controls: life === 2 ? 0 : 1,
          pinSeconds: life === 2 ? 0 : 2,
          counterDeltas: {},
        })),
      ),
      hits: [],
      clearStats: players.map((value) => ({
        playerId: value.id,
        playerAlias: value.alias,
        deathCorrelatedClears: 1,
        responseSeconds: [1],
        medianResponseSeconds: 1,
      })),
      tankEncounters: [],
    },
  };
};

describe("game rating projection", () => {
  it("recomputes eligible role-aware ratings from selected maps and halves", () => {
    const maps = [demo(), demo()];
    const result = rateGamePlayers(maps, aggregateGamePlayers(maps));
    expect(result.players).toHaveLength(8);
    expect(result.players.every((player) => player.rating !== null)).toBe(true);
    expect(result.mvp.status).not.toBe("unavailable");
    expect(
      result.players.every((player) => player.survivor.pillars.length >= 2),
    ).toBe(true);
    expect(
      result.players.every((player) => player.infected.pillars.length >= 2),
    ).toBe(true);
  });

  it("never treats checkpoint total infected kills as Common kills or rating input", () => {
    const baseline = demo();
    const inflated = demo();
    for (const half of inflated.competitive?.halves ?? []) {
      const target = half.players.find((value) => value.playerId === "0");
      if (target?.summary) target.summary.checkpointInfectedKills = 100_000;
    }
    const baselineRating = rateGamePlayers(
      [baseline],
      aggregateGamePlayers([baseline]),
    ).players.find((value) => value.playerId.endsWith(":0"));
    const inflatedRating = rateGamePlayers(
      [inflated],
      aggregateGamePlayers([inflated]),
    ).players.find((value) => value.playerId.endsWith(":0"));
    expect(inflatedRating?.rating).toBe(baselineRating?.rating);
    expect(inflatedRating?.survivor.score).toBe(baselineRating?.survivor.score);
  });
});
