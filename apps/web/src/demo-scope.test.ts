import { describe, expect, it } from "vitest";
import type {
  CompetitiveHalfPlayerSummary,
  DemoStats,
  PlayerStats,
} from "./api";
import { halfScopeKey, scopeDemoStats } from "./demo-scope";

const summary = (
  overrides: Partial<CompetitiveHalfPlayerSummary> = {},
): CompetitiveHalfPlayerSummary => ({
  sampleCount: 10,
  durationSeconds: 9,
  distanceUnits: 100,
  viewTravelDegrees: 50,
  observedPositionRate: 0.8,
  observedAnglesRate: 0.9,
  observedTeamRate: 1,
  observedClassRate: 1,
  observedWeaponRate: 0.7,
  weapons: ["rifle"],
  survivorDeaths: 0,
  infectedDeaths: 0,
  specialInfectedKills: 1,
  headshotKills: 0,
  pinSeconds: 0,
  ghostSeconds: 0,
  observedHealthLost: 20,
  killsByWeapon: { rifle: 1 },
  killsByInfectedClass: { Hunter: 1 },
  infectedClasses: [],
  ...overrides,
});

const player: PlayerStats = {
  id: "player-1",
  alias: "Ellis",
  identity: { displayName: "Ellis", steamId64: "76561198000000001" },
  team: null,
  playerClass: null,
  sampleCount: 20,
  durationSeconds: 19,
  distanceUnits: 300,
  viewTravelDegrees: 100,
  observedPositionRate: 0.9,
  observedAnglesRate: 0.9,
  weapons: ["rifle"],
  evidenceWindows: 0,
};

const fixture = (): DemoStats => ({
  durationSeconds: 20,
  playbackTicks: 200,
  tickRate: 10,
  playerCount: 1,
  observationCount: 20,
  eventCount: 2,
  requiredEvents: {},
  decodeIssueCount: 0,
  availability: {
    position: 0.9,
    eyeAngles: 0.9,
    team: 1,
    playerClass: 1,
    weapon: 0.8,
  },
  timeline: [
    {
      tick: 40,
      timeSeconds: 4,
      type: "death",
      actor: "Ellis",
      actorPlayerId: "player-1",
      infectedClass: "Hunter",
      weapon: "rifle",
      detail: "first-half kill",
    },
    {
      tick: 140,
      timeSeconds: 14,
      type: "death",
      victim: "Ellis",
      victimPlayerId: "player-1",
      detail: "second-half death",
    },
  ],
  competitive: {
    derivationVersion: 1,
    rosters: [],
    halves: [
      {
        id: "first",
        secondHalf: false,
        tickRange: { start: 0, end: 99 },
        survivorPlayerIds: ["player-1"],
        infectedPlayerIds: [],
        players: [
          {
            playerId: "player-1",
            side: "Survivor",
            counterDeltas: { m_checkpointDamageToTank: 200 },
            observedCounters: ["m_checkpointDamageToTank"],
            summary: summary(),
          },
        ],
      },
      {
        id: "second",
        secondHalf: true,
        tickRange: { start: 100, end: 199 },
        survivorPlayerIds: [],
        infectedPlayerIds: ["player-1"],
        players: [
          {
            playerId: "player-1",
            side: "Infected",
            counterDeltas: { m_checkpointPZKills: 2 },
            observedCounters: ["m_checkpointPZKills"],
            summary: summary({ infectedClasses: ["Hunter"] }),
          },
        ],
      },
    ],
    infectedLives: [],
    hits: [],
    clearStats: [],
    tankEncounters: [],
  },
  survivorHealthTraces: [
    {
      playerId: "player-1",
      playerAlias: "Ellis",
      sourceSamples: 2,
      healthCoverage: 1,
      bufferCoverage: 1,
      points: [
        { tick: 20, timeSeconds: 2, health: 100 },
        { tick: 120, timeSeconds: 12, health: 80 },
      ],
    },
  ],
  survivorLoadoutTraces: [
    {
      playerId: "player-1",
      playerAlias: "Ellis",
      sourceSamples: 2,
      coverage: { primaryWeapon: 1, firstAid: 1, temporaryHealth: 1 },
      points: [
        {
          tick: 20,
          timeSeconds: 2,
          primaryWeapon: { id: 2, name: "SMG", category: "primary" },
        },
        {
          tick: 120,
          timeSeconds: 12,
          primaryWeapon: { id: 26, name: "AK-47", category: "primary" },
        },
      ],
    },
  ],
  survivorAmmoTraces: [
    {
      playerId: "player-1",
      playerAlias: "Ellis",
      sourceSamples: 2,
      coverage: 1,
      points: [
        {
          tick: 20,
          timeSeconds: 2,
          weaponClass: "CSubMachinegun",
          clip: 50,
          reserve: 650,
        },
        {
          tick: 120,
          timeSeconds: 12,
          weaponClass: "CWeaponRifle",
          clip: 40,
          reserve: 320,
        },
      ],
    },
  ],
  players: [player],
});

describe("round scoped demo statistics", () => {
  it("recomputes player, event, health, coverage and competitive data", () => {
    const scoped = scopeDemoStats(fixture(), "demo", [
      halfScopeKey("demo", "second"),
    ]);

    expect(scoped.durationSeconds).toBe(10);
    expect(scoped.timeline?.map((event) => event.detail)).toEqual([
      "first-half kill",
    ]);
    expect(scoped.players).toHaveLength(1);
    expect(scoped.players[0]).toMatchObject({
      alias: "Ellis",
      team: 2,
      sampleCount: 10,
      specialInfectedKills: 1,
      counters: { m_checkpointDamageToTank: 200 },
    });
    expect(scoped.availability).toEqual({
      position: 0.8,
      eyeAngles: 0.9,
      team: 1,
      playerClass: 1,
      weapon: 0.7,
    });
    expect(scoped.competitive?.halves.map((half) => half.id)).toEqual([
      "first",
    ]);
    expect(scoped.survivorHealthTraces?.[0]?.points).toHaveLength(1);
    expect(scoped.survivorLoadoutTraces?.[0]?.points).toHaveLength(1);
    expect(
      scoped.survivorLoadoutTraces?.[0]?.points[0]?.primaryWeapon?.name,
    ).toBe("SMG");
    expect(scoped.survivorAmmoTraces?.[0]?.points).toHaveLength(1);
  });

  it("leaves legacy artifacts without per-half summaries unchanged", () => {
    const stats = fixture();
    delete stats.competitive!.halves[0]!.players[0]!.summary;
    expect(
      scopeDemoStats(stats, "demo", [halfScopeKey("demo", "second")]),
    ).toBe(stats);
  });

  it("can exclude a demo whose only selected scope was disabled", () => {
    const stats = fixture();
    stats.competitive!.halves = [stats.competitive!.halves[0]!];
    const scoped = scopeDemoStats(stats, "demo", [
      halfScopeKey("demo", "first"),
    ]);
    expect(scoped.players).toEqual([]);
    expect(scoped.timeline).toEqual([]);
    expect(scoped.durationSeconds).toBe(0);
    expect(scoped.competitive?.halves).toEqual([]);
  });

  it("carries the latest sampled state into a later selected half", () => {
    const scoped = scopeDemoStats(fixture(), "demo", [
      halfScopeKey("demo", "first"),
    ]);
    expect(
      scoped.survivorHealthTraces?.[0]?.points.map((point) => point.tick),
    ).toEqual([20, 120]);
    expect(
      scoped.survivorLoadoutTraces?.[0]?.points.map((point) => point.tick),
    ).toEqual([20, 120]);
    expect(
      scoped.survivorAmmoTraces?.[0]?.points.map((point) => point.tick),
    ).toEqual([20, 120]);
  });
});
