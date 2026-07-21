import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  L4d2MatchState,
  ProjectedPlayerObservation,
} from "@l4dstats/contracts";
import {
  buildBoundedContextWindow,
  buildEvidenceBundle,
  buildEvidenceBundleFromPrepared,
  clusterSpawnWindows,
  deriveCompetitiveStats,
  deriveObservedOpeningAreaV1,
  deriveRecorderCommandEvidence,
  deriveSurvivorHealthTraces,
  maximumObservedHealthDrawdown,
  sumPositiveCounterDeltas,
  type DemoStats,
} from "./evidence-bundle";
import { stableJson } from "./report";
import { prepareNativeDemoProjection } from "./native-demo-provider";

const seamCorpusDemo = resolve(
  "../../data/sprint-1-corpus/extracted/901780_c2m1_highway/901780_c2m1_highway.dem",
);
describe.runIf(existsSync(seamCorpusDemo))(
  "prepared demo projection seam",
  () => {
    it("preserves the canonical bundle through direct and prepared paths", async () => {
      const bytes = readFileSync(seamCorpusDemo);
      const options = { pseudonymKey: "controlled-prepared-seam-key" };
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        "299019bf3e956176034230b3ad28b634016ec8fe0334ca6c6b95cc0597ac483d",
      );
      const prepared = await prepareNativeDemoProjection(bytes, options);
      const direct = await buildEvidenceBundle(bytes, options);
      const injected = buildEvidenceBundleFromPrepared(prepared, options);

      expect(injected).toEqual(direct);
      expect(stableJson(injected)).toBe(stableJson(direct));
      expect(direct).toMatchObject({
        schemaVersion: 1,
        demo: {
          sha256: prepared.demoSha256,
          mapName: "c2m1_highway",
          bytes: bytes.byteLength,
          session: { campaign: "c2", chapter: 1 },
        },
      });
      expect(prepared.identity.displayIdentities.length).toBeGreaterThan(0);
      expect(prepared.serverInfo).not.toBeNull();
      const unavailable = {
        ...prepared,
        tickIntervalSeconds: null,
        matchStates: [],
        serverInfo: null,
      } as const;
      const bundle = buildEvidenceBundleFromPrepared(unavailable, {
        pseudonymKey: "controlled-prepared-seam-key",
      });
      expect(unavailable.tickIntervalSeconds).toBeNull();
      expect(unavailable.matchStates).toEqual([]);
      expect(bundle.demo.session.serverCount).toBeNull();
      expect(bundle.demo.stats.match.roundNumber).toBeNull();
    }, 120_000);
  },
);

describe("evidence bundle windows", () => {
  it("counts maximum contiguous health drawdown without double-counting healing", () => {
    expect(
      maximumObservedHealthDrawdown(
        [
          { tick: 0, health: 100, upright: true },
          { tick: 1, health: 30, upright: true },
          { tick: 2, health: 100, upright: true },
          { tick: 3, health: 30, upright: true },
          { tick: 4, health: 300, upright: true },
          { tick: 5, health: 1, upright: false },
        ],
        0.1,
      ),
    ).toBe(70);
  });

  it("does not bridge missing health coverage", () => {
    expect(
      maximumObservedHealthDrawdown(
        [
          { tick: 0, health: 100, upright: true },
          { tick: 3, health: 20, upright: true },
        ],
        0.1,
      ),
    ).toBe(0);
  });

  it("byte-thins retained real-shaped observations below the storage cap", () => {
    const longReason = "explicitly unavailable ".repeat(200);
    const observations = Array.from({ length: 1_200 }, (_, tick) => ({
      observation: {
        schemaVersion: 1 as const,
        demoSha256: "a".repeat(64),
        playerEpochId: `epoch-${tick % 16}-${"x".repeat(1_000)}`,
        tick,
        demoTimeSeconds: { availability: "derived" as const, value: tick / 30 },
        position: {
          availability: "observed" as const,
          value: { x: tick, y: tick + 1, z: tick + 2 },
        },
        eyeAngles: {
          availability: "observed" as const,
          value: { pitch: 0, yaw: tick % 360, roll: 0 },
        },
        team: { availability: "observed" as const, value: tick % 2 ? 2 : 3 },
        playerClass: {
          availability: "unavailable" as const,
          reason: longReason,
        },
        weapon: { availability: "unavailable" as const, reason: longReason },
        buttons: { availability: "unavailable" as const, reason: longReason },
      },
      l4d2: { entityIndex: tick % 16 },
      provenance: {} as ProjectedPlayerObservation["provenance"],
    })) satisfies ProjectedPlayerObservation[];
    const window = buildBoundedContextWindow(300, 301, observations, 1 / 30);
    expect(window.endTick - window.startTick).toBe(240);
    expect(
      Buffer.byteLength(JSON.stringify(window.payload)),
    ).toBeLessThanOrEqual(240 * 1024);
    expect(
      (window.payload as { retainedObservationCount: number })
        .retainedObservationCount,
    ).toBeLessThanOrEqual(512);
  });
});

describe("recorder command evidence", () => {
  it("counts held intent and only derives edges across contiguous commands", () => {
    const command = (commandNumber: number, buttons: number) => ({
      schemaVersion: 1 as const,
      demoSha256: "a".repeat(64),
      demoTick: commandNumber,
      demoTimeSeconds: {
        availability: "derived" as const,
        value: commandNumber / 30,
      },
      recorderPlayerEpochId: {
        availability: "unavailable" as const,
        reason: "fixture",
      },
      outgoingSequence: commandNumber,
      commandNumber,
      clientTickCount: commandNumber + 100,
      viewAngles: { pitch: 0, yaw: 0, roll: 0 },
      intendedMovement: {
        forward: commandNumber === 1 ? 450 : 0,
        side: 0,
        up: 0,
      },
      buttons,
      impulse: 0,
      weaponSelect: {
        availability: "unavailable" as const,
        reason: "not present",
      },
      weaponSubtype: {
        availability: "unavailable" as const,
        reason: "not present",
      },
      mouseDelta: { x: commandNumber === 1 ? 3 : 0, y: 0 },
      provenance: {
        source: "dem_usercmd" as const,
        scope: "recorder-only" as const,
        semantics: "client-command-intent" as const,
      },
    });
    const result = deriveRecorderCommandEvidence(
      [command(1, 1), command(2, 1), command(4, 1)],
      {
        availability: "observed",
        totalCommands: 3,
        decodedCommands: 3,
        malformedCommands: 0,
        commandGaps: 1,
        firstDemoTick: 1,
        lastDemoTick: 4,
        recorderPlayerEpochId: {
          availability: "unavailable",
          reason: "fixture",
        },
      },
    );
    expect(result.heldCommandCounts.attack).toBe(3);
    expect(result.pressCounts.attack).toBe(2);
    expect(result.intendedMovementCommands).toBe(1);
    expect(result.nonzeroMouseDeltaCommands).toBe(1);
    expect(result.limitations.join(" ")).toContain("not a fired shot");
  });
});

const projectedRow = (input: {
  id: string;
  tick: number;
  team: number;
  playerClass: string;
  ghost?: boolean;
  health?: number;
  maxHealth?: number;
  healthBuffer?: number;
  incapacitated?: boolean;
  frustration?: number;
  pounceVictim?: number;
  counters?: Record<string, number>;
  position?: { x: number; y: number; z: number };
}): ProjectedPlayerObservation => ({
  observation: {
    schemaVersion: 1,
    demoSha256: "a".repeat(64),
    playerEpochId: input.id,
    tick: input.tick,
    demoTimeSeconds: { availability: "derived", value: input.tick / 10 },
    position: input.position
      ? { availability: "observed", value: input.position }
      : { availability: "unavailable", reason: "fixture" },
    eyeAngles: { availability: "unavailable", reason: "fixture" },
    team: { availability: "observed", value: input.team },
    playerClass: { availability: "observed", value: input.playerClass },
    weapon: { availability: "unavailable", reason: "fixture" },
    buttons: { availability: "unavailable", reason: "fixture" },
  },
  l4d2: {
    entityIndex: input.id === "infected" ? 7 : 2,
    ...(input.ghost === undefined ? {} : { ghost: input.ghost }),
    ...(input.health === undefined ? {} : { health: input.health }),
    ...(input.maxHealth === undefined ? {} : { maxHealth: input.maxHealth }),
    ...(input.healthBuffer === undefined
      ? {}
      : { healthBuffer: input.healthBuffer }),
    ...(input.incapacitated === undefined
      ? {}
      : { incapacitated: input.incapacitated }),
    ...(input.frustration === undefined
      ? {}
      : { frustration: input.frustration }),
    ...(input.pounceVictim === undefined
      ? {}
      : { pounceVictim: input.pounceVictim }),
    ...(input.counters === undefined ? {} : { counters: input.counters }),
  },
  provenance: {} as ProjectedPlayerObservation["provenance"],
});

describe("competitive artifact derivation", () => {
  it("derives a bounded observed Survivor opening area without claiming a saferoom", () => {
    const projected = [
      ["s1", 100, 200, 12],
      ["s2", 140, 220, 13],
      ["s3", 120, 260, 14],
      ["s4", 160, 240, 15],
    ].map(([id, x, y, tick]) =>
      projectedRow({
        id: String(id),
        tick: Number(tick),
        team: 2,
        playerClass: "Survivor",
        position: { x: Number(x), y: Number(y), z: 32 },
      }),
    );
    const result = deriveObservedOpeningAreaV1({
      projected,
      timeline: [
        {
          tick: 10,
          timeSeconds: 1,
          type: "round_start",
          detail: "round started",
        },
      ],
      halfTickRange: { start: 0, end: 1_000 },
      survivorPlayerIds: ["s1", "s2", "s3", "s4"],
      tickIntervalSeconds: 0.1,
    });
    expect(result).toMatchObject({
      availability: "derived",
      center: { x: 130, y: 230, z: 32 },
      derivation: "survivor-opening-area-v1",
    });
    if (result.availability !== "derived") throw new Error("expected area");
    expect(result.samples.map((sample) => sample.playerId)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    expect(result.planarRadiusUnits).toBeCloseTo(Math.sqrt(1_800));
    expect(JSON.stringify(result)).not.toMatch(/safe.?room/i);
  });

  it("does not infer an opening area without an observed round start", () => {
    const result = deriveObservedOpeningAreaV1({
      projected: [
        projectedRow({
          id: "s1",
          tick: 0,
          team: 2,
          playerClass: "Survivor",
          position: { x: 0, y: 0, z: 0 },
        }),
      ],
      timeline: [],
      halfTickRange: { start: 0, end: 1_000 },
      survivorPlayerIds: ["s1"],
      tickIntervalSeconds: 0.1,
    });
    expect(result).toEqual({
      availability: "unavailable",
      derivation: "survivor-opening-area-v1",
      reason: "round-start-unobserved",
      observedPlayerIds: [],
    });
  });

  it("bounds hit windows from the first spawn instead of chaining long lives", () => {
    const windows = clusterSpawnWindows(
      [
        { id: "a", tickRange: { start: 100, end: 2_000 } },
        { id: "b", tickRange: { start: 170, end: 2_100 } },
        { id: "c", tickRange: { start: 240, end: 2_200 } },
      ],
      0.1,
    );
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ start: 100, end: 239 });
    expect(windows[0]!.group.map((life) => life.id)).toEqual(["a", "b"]);
    expect(windows[1]).toMatchObject({ start: 240, end: 320 });
    expect(windows[0]!.end).toBeLessThan(windows[1]!.start);
    for (const window of windows) {
      const lastSpawn = Math.max(
        ...window.group.map((life) => life.tickRange.start),
      );
      expect((window.end - lastSpawn) * 0.1).toBeLessThanOrEqual(8);
    }
  });

  it("rejects a missing tick interval instead of producing life-long hits", () => {
    expect(() =>
      clusterSpawnWindows([{ tickRange: { start: 100, end: 2_000 } }], 0),
    ).toThrow("secondsPerTick must be positive");
  });

  it("bounds Survivor health traces while retaining material state changes", () => {
    const rows = [
      projectedRow({
        id: "survivor",
        tick: 0,
        team: 2,
        playerClass: "Survivor",
        health: 100,
        maxHealth: 100,
        healthBuffer: 0,
      }),
      projectedRow({
        id: "survivor",
        tick: 1,
        team: 2,
        playerClass: "Survivor",
        health: 100,
        maxHealth: 100,
        healthBuffer: 0,
      }),
      projectedRow({
        id: "survivor",
        tick: 2,
        team: 2,
        playerClass: "Survivor",
        health: 62,
        maxHealth: 100,
        healthBuffer: 20,
      }),
      projectedRow({
        id: "survivor",
        tick: 3,
        team: 2,
        playerClass: "Survivor",
        health: 1,
        maxHealth: 100,
        healthBuffer: 0,
        incapacitated: true,
      }),
      projectedRow({
        id: "infected",
        tick: 3,
        team: 3,
        playerClass: "Hunter",
        health: 250,
      }),
    ];
    const traces = deriveSurvivorHealthTraces({
      projected: rows,
      participantIds: new Set(["survivor", "infected"]),
      aliases: new Map([["survivor", "Alice"]]),
      tickIntervalSeconds: 0.1,
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      playerId: "survivor",
      playerAlias: "Alice",
      sourceSamples: 4,
      healthCoverage: 1,
      bufferCoverage: 1,
      points: [
        { tick: 0, health: 100, healthBuffer: 0 },
        { tick: 2, health: 62, healthBuffer: 20 },
        { tick: 3, health: 1, incapacitated: true },
      ],
    });
  });

  it("sums positive counter deltas across resets without treating the reset as output", () => {
    const rows = [0, 4, 9, 0, 3].map((value, index) =>
      projectedRow({
        id: "infected",
        tick: index,
        team: 3,
        playerClass: "Hunter",
        counters: { m_checkpointPZHunterDamage: value },
      }),
    );
    expect(sumPositiveCounterDeltas(rows)).toMatchObject({
      m_checkpointPZHunterDamage: 12,
    });
  });

  it("derives neutral halves, SI lives/hits, clear response and a Tank encounter", () => {
    const projected = [
      projectedRow({
        id: "survivor",
        tick: 0,
        team: 2,
        playerClass: "Survivor",
      }),
      projectedRow({
        id: "infected",
        tick: 0,
        team: 3,
        playerClass: "Hunter",
        ghost: true,
      }),
      projectedRow({
        id: "infected",
        tick: 10,
        team: 3,
        playerClass: "Hunter",
        ghost: false,
        pounceVictim: 2,
        counters: { m_checkpointPZHunterDamage: 0 },
      }),
      projectedRow({
        id: "survivor",
        tick: 10,
        team: 2,
        playerClass: "Survivor",
        health: 100,
      }),
      projectedRow({
        id: "survivor",
        tick: 12,
        team: 2,
        playerClass: "Survivor",
        health: 85,
      }),
      projectedRow({
        id: "survivor",
        tick: 12,
        team: 2,
        playerClass: "Survivor",
        health: 100,
      }),
      projectedRow({
        id: "survivor",
        tick: 12,
        team: 2,
        playerClass: "Survivor",
        health: 85,
      }),
      projectedRow({
        id: "survivor",
        tick: 13,
        team: 2,
        playerClass: "Survivor",
        health: 300,
        incapacitated: true,
      }),
      projectedRow({
        id: "survivor",
        tick: 14,
        team: 2,
        playerClass: "Survivor",
        health: 250,
        incapacitated: true,
      }),
      projectedRow({
        id: "infected",
        tick: 20,
        team: 3,
        playerClass: "Hunter",
        ghost: false,
        counters: { m_checkpointPZHunterDamage: 8 },
      }),
      projectedRow({
        id: "infected",
        tick: 21,
        team: 3,
        playerClass: "Hunter",
        ghost: true,
        counters: { m_checkpointPZHunterDamage: 8 },
      }),
      projectedRow({
        id: "survivor",
        tick: 50,
        team: 3,
        playerClass: "Smoker",
        ghost: true,
      }),
      projectedRow({
        id: "infected",
        tick: 50,
        team: 2,
        playerClass: "Survivor",
      }),
      projectedRow({
        id: "survivor",
        tick: 51,
        team: 2,
        playerClass: "Survivor",
      }),
      projectedRow({
        id: "infected",
        tick: 51,
        team: 3,
        playerClass: "Hunter",
        ghost: true,
      }),
      projectedRow({
        id: "infected",
        tick: 60,
        team: 2,
        playerClass: "Survivor",
        counters: { m_checkpointDamageToTank: 0 },
      }),
      projectedRow({
        id: "survivor",
        tick: 60,
        team: 3,
        playerClass: "Tank",
        ghost: false,
        health: 6000,
        frustration: 10,
        counters: {
          m_checkpointPZTankPunches: 0,
          m_checkpointPZTankThrows: 0,
          m_checkpointPZTankDamage: 0,
        },
      }),
      projectedRow({
        id: "infected",
        tick: 70,
        team: 2,
        playerClass: "Survivor",
        counters: { m_checkpointDamageToTank: 1800 },
      }),
      projectedRow({
        id: "survivor",
        tick: 70,
        team: 3,
        playerClass: "Tank",
        ghost: false,
        health: 4200,
        frustration: 45,
        counters: {
          m_checkpointPZTankPunches: 2,
          m_checkpointPZTankThrows: 1,
          m_checkpointPZTankDamage: 65,
        },
      }),
      projectedRow({
        id: "survivor",
        tick: 80,
        team: 3,
        playerClass: "Smoker",
        ghost: true,
      }),
    ];
    const timeline: DemoStats["timeline"] = [
      {
        tick: 10,
        timeSeconds: 1,
        type: "pin_start",
        actor: "Inf",
        victim: "Surv",
        infectedClass: "Hunter",
        detail: "pin",
      },
      {
        tick: 20,
        timeSeconds: 2,
        type: "death",
        actor: "Surv",
        victim: "Inf",
        infectedClass: "Hunter",
        detail: "death",
      },
      {
        tick: 20,
        timeSeconds: 2,
        type: "pin_end",
        actor: "Inf",
        victim: "Surv",
        infectedClass: "Hunter",
        detail: "end",
      },
      {
        tick: 20,
        timeSeconds: 2,
        type: "clear",
        actor: "Surv",
        victim: "Surv",
        infectedClass: "Hunter",
        detail: "clear",
      },
      {
        tick: 20,
        timeSeconds: 2,
        type: "clear",
        actor: "Surv",
        victim: "Surv",
        infectedClass: "Charger",
        detail: "duplicate carry/pummel clear",
      },
      {
        tick: 65,
        timeSeconds: 6.5,
        type: "incap",
        victim: "Inf",
        detail: "incap",
      },
      {
        tick: 75,
        timeSeconds: 7.5,
        type: "death",
        victim: "Inf",
        detail: "survivor death",
      },
    ];
    const matchStates = [
      {
        tick: 0,
        campaignScores: [],
        chapterScores: [],
        survivorScores: [],
        survivorDistances: [],
        survivorDeathDistances: [],
        roundDurations: [],
        secondHalf: false,
      },
      {
        tick: 50,
        campaignScores: [],
        chapterScores: [],
        survivorScores: [],
        survivorDistances: [],
        survivorDeathDistances: [],
        roundDurations: [],
        secondHalf: true,
      },
    ] satisfies L4d2MatchState[];
    const result = deriveCompetitiveStats({
      projected,
      matchStates,
      timeline,
      aliases: new Map([
        ["survivor", "Surv"],
        ["infected", "Inf"],
      ]),
      playbackTicks: 100,
      tickIntervalSeconds: 0.1,
    });
    expect(result.derivationVersion).toBe(6);
    expect(result.halves).toHaveLength(2);
    expect(result.halves[0]).toMatchObject({
      survivorPlayerIds: ["survivor"],
      infectedPlayerIds: ["infected"],
    });
    expect(
      result.halves[0]?.players.find((player) => player.playerId === "infected")
        ?.observedCounters,
    ).toContain("m_checkpointPZHunterDamage");
    expect(
      result.halves[0]?.players.find((player) => player.playerId === "infected")
        ?.summary,
    ).toMatchObject({
      sampleCount: 4,
      infectedClasses: ["Hunter"],
      observedTeamRate: 1,
      observedClassRate: 1,
      pinSeconds: 0.25,
    });
    expect(result.halves[1]).toMatchObject({
      survivorPlayerIds: ["infected"],
      infectedPlayerIds: ["survivor"],
    });
    expect(result.rosters).toEqual([
      {
        id: "A",
        playerIds: ["survivor"],
        confidence: "provisional",
        inference: "side-swap-v1",
        sides: [
          { halfId: "first", side: "Survivor" },
          { halfId: "second", side: "Infected" },
        ],
      },
      {
        id: "B",
        playerIds: ["infected"],
        confidence: "provisional",
        inference: "side-swap-v1",
        sides: [
          { halfId: "first", side: "Infected" },
          { halfId: "second", side: "Survivor" },
        ],
      },
    ]);
    expect(
      result.infectedLives.find((life) => life.infectedClass === "Hunter"),
    ).toMatchObject({
      startReason: "spawn",
      endReason: "death",
      controls: 1,
      counterDeltas: { m_checkpointPZHunterDamage: 8 },
    });
    expect(result.hits[0]).toMatchObject({
      controls: 1,
      peakSimultaneousPins: 1,
      observedSurvivorHealthLoss: 15,
      survivorHealthSamples: 2,
    });
    expect(result.clearStats[0]).toMatchObject({
      playerId: "survivor",
      deathCorrelatedClears: 1,
      medianResponseSeconds: 1,
    });
    expect(result.tankEncounters[0]).toMatchObject({
      controllerId: "survivor",
      healthAtTake: 6000,
      lowestObservedHealth: 4200,
      maximumObservedFrustration: 45,
      punches: 2,
      registeredRockThrows: 1,
      damageDealt: 65,
      damageTaken: 1800,
      damageBySurvivor: [
        { playerId: "infected", playerAlias: "Inf", damage: 1800 },
      ],
      survivorIncaps: 1,
      survivorDeaths: 1,
      endReason: "control-ended",
    });
  });
});
