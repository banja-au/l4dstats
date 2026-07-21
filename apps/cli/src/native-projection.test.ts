import { describe, expect, it } from "vitest";
import { rehydrateNativeProjection } from "./native-projection";

const hash = "a".repeat(64);
function artifact(row?: unknown) {
  return {
    version: 2,
    header: {
      stamp: "HL2DEMO",
      demoProtocol: 4,
      networkProtocol: 2100,
      serverName: "s",
      clientName: "SourceTV",
      mapName: "c1m1_hotel",
      gameDirectory: "left4dead2",
      playbackTimeSeconds: 0,
      playbackTicks: 0,
      playbackFrames: 0,
      signonLength: 0,
    },
    framingIssues: [],
    bytesConsumed: 1072,
    stopped: true,
    projection: {
      demoSha256: hash,
      epochs: [],
      displayIdentities: [],
      identityMappings: [],
      rejectedIdentityEntries: 0,
      serverInfo: null,
      matchStates: [],
      witchObservations: [],
      coverage: {
        framesVisited: 0,
        observationsEmitted: row === undefined ? 0 : 1,
        fieldAvailability: {},
      },
      observations: {
        epochs: row === undefined ? [] : ["epoch"],
        strings: [],
        counters: [],
        propertyPaths: [],
        rows: row === undefined ? [] : [row],
      },
    },
    rawEvents: [],
    eventSummary: { schemaLists: 0, schemas: 0, events: 0, requiredEvents: {} },
    sourcePerspective: "source-tv",
    recorderCommands: [],
    commandTelemetrySummary: {
      commands: 0,
      decodedCommands: 0,
      malformedCommands: 0,
      firstDemoTick: null,
      lastDemoTick: null,
      recorderPlayerSlot: null,
      recorderIdentityConfidence: "unavailable",
      gaps: 0,
    },
  };
}
const expected = { demoSha256: hash, bytes: 1072 };
describe("native compact projection validation", () => {
  it("rehydrates an empty bounded artifact with explicit missing timing", () => {
    const value = rehydrateNativeProjection(artifact(), expected);
    expect(value).toMatchObject({
      demoSha256: hash,
      bytes: 1072,
      tickIntervalSeconds: null,
      observations: [],
      serverInfo: null,
    });
  });
  it("rejects versions, unknown fields and mismatched input lineage", () => {
    expect(() =>
      rehydrateNativeProjection({ ...artifact(), version: 1 }, expected),
    ).toThrow("version must be 2");
    expect(() =>
      rehydrateNativeProjection({ ...artifact(), extra: true }, expected),
    ).toThrow("fields are invalid");
    expect(() =>
      rehydrateNativeProjection(artifact(), {
        ...expected,
        demoSha256: "b".repeat(64),
      }),
    ).toThrow("does not match the input");
  });
  it("rehydrates recorder commands as recorder-only client intent", () => {
    const pov = artifact();
    pov.sourcePerspective = "player-pov";
    (pov.recorderCommands as unknown[]) = [
      {
        demoTick: 12,
        recorderPlayerSlot: 0,
        outgoingSequence: 41,
        commandNumber: 41,
        tickCount: 900,
        viewAngles: [1, 2, 0],
        forwardMove: 450,
        sideMove: 0,
        upMove: 0,
        buttons: 1,
        impulse: 0,
        weaponSelect: null,
        weaponSubtype: null,
        mouseDx: 4,
        mouseDy: -2,
        consumedBits: 13,
        sourceBits: 16,
      },
    ];
    pov.commandTelemetrySummary = {
      commands: 1,
      decodedCommands: 1,
      malformedCommands: 0,
      firstDemoTick: 12,
      lastDemoTick: 12,
      recorderPlayerSlot: 0,
      recorderIdentityConfidence: "observed",
      gaps: 0,
    } as unknown as typeof pov.commandTelemetrySummary;
    const value = rehydrateNativeProjection(pov, expected);
    expect(value.sourcePerspective).toBe("player-pov");
    expect(value.recorderCommandCoverage).toMatchObject({
      availability: "observed",
      decodedCommands: 1,
    });
    expect(value.recorderCommands[0]).toMatchObject({
      commandNumber: 41,
      clientTickCount: 900,
      buttons: 1,
      provenance: {
        source: "dem_usercmd",
        scope: "recorder-only",
        semantics: "client-command-intent",
      },
    });
    expect(value.recorderCommands[0]?.recorderPlayerEpochId.availability).toBe(
      "unavailable",
    );
  });
  it("rejects row lengths, registry indexes, masks and non-finite values", () => {
    const base = [
      0,
      1,
      1,
      null,
      null,
      null,
      null,
      null,
      [1, 0, []],
      [null, 0, [], 0, [], null, null, 0, null],
    ];
    expect(() => rehydrateNativeProjection(artifact(base), expected)).toThrow(
      "unknown epoch",
    );
    const withEpoch = {
      ...artifact(base),
      projection: {
        ...artifact(base).projection,
        epochs: [
          {
            id: "epoch",
            entitySlot: 1,
            lifetime: 1,
            userId: null,
            stableToken: null,
            connectedAtTick: 1,
            disconnectedAtTick: null,
          },
        ],
      },
    };
    const short = structuredClone(withEpoch);
    short.projection.observations.rows[0] = base.slice(0, 9);
    expect(() => rehydrateNativeProjection(short, expected)).toThrow(
      "must have 10 fields",
    );
    const badMask = structuredClone(withEpoch);
    (badMask.projection.observations.rows as unknown[][])[0]![8] = [
      1,
      1 << 22,
      [],
    ];
    expect(() => rehydrateNativeProjection(badMask, expected)).toThrow("mask");
    const badFinite = structuredClone(withEpoch);
    (badFinite.projection.observations.rows as unknown[][])[0]![1] = Number.NaN;
    expect(() => rehydrateNativeProjection(badFinite, expected)).toThrow(
      "finite",
    );
  });
  it("rejects malformed nested match, coverage and event primitives", () => {
    const badMatch = artifact();
    (badMatch.projection.matchStates as unknown[]) = [
      {
        tick: 1,
        campaignScores: [0, null],
        chapterScores: [0, null],
        survivorScores: [0, null],
        survivorDistances: Array(8).fill(null),
        survivorDeathDistances: Array(8).fill(null),
        roundDurations: [0, null],
        roundNumber: Number.NaN,
        teamsFlipped: null,
        secondHalf: null,
        voteRestarting: null,
        roundSetupTimeRemaining: null,
      },
    ];
    expect(() => rehydrateNativeProjection(badMatch, expected)).toThrow(
      "finite",
    );
    const badCoverage = artifact();
    badCoverage.projection.coverage.framesVisited = -1;
    expect(() => rehydrateNativeProjection(badCoverage, expected)).toThrow(
      "out of range",
    );
    const badEvent = artifact();
    (badEvent.rawEvents as unknown[]) = [
      {
        demoTick: 1,
        engineTick: null,
        event: {
          id: 1,
          name: "x",
          fields: { bad: {} },
          schema: { id: 1, name: "x", fields: [] },
        },
        required: null,
      },
    ];
    expect(() => rehydrateNativeProjection(badEvent, expected)).toThrow(
      "primitive is invalid",
    );
  });
});
