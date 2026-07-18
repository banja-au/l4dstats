import { describe, expect, it } from "vitest";
import { rehydrateNativeProjection } from "./native-projection";

const hash = "a".repeat(64);
function artifact(row?: unknown) {
  return {
    version: 1,
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
      rehydrateNativeProjection({ ...artifact(), version: 2 }, expected),
    ).toThrow("version is out of range");
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
