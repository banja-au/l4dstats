import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  comparePlaybackCheckpoints,
  exportPlaybackCheckpoints,
  parsePlaybackExportRequest,
  type PlaybackCheckpointExport,
  type PlaybackReference,
} from "./playback-validation";
import { prepareNativeDemoProjection } from "./native-demo-provider";

const corpusDemo = resolve(
  "../../data/sprint-1-corpus/extracted/901780_c2m1_highway/901780_c2m1_highway.dem",
);

const bytes = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const observed: PlaybackCheckpointExport = {
  schemaVersion: 1,
  producer: "l4dstats",
  demoSha256: "a".repeat(64),
  mapName: "c1m1_hotel",
  l4dstatsRevision: "abc123",
  selectedTicks: [100],
  checkpoints: [
    {
      tick: 100,
      players: [
        {
          playerEpochId: `${"a".repeat(64)}:3:7`,
          entitySlot: 3,
          lifetime: 7,
          team: { availability: "observed", value: 2 },
          playerClass: { availability: "observed", value: "zombie-class:0" },
          position: {
            availability: "observed",
            value: { x: 10, y: 20, z: 30 },
          },
          eyeAngles: {
            availability: "derived",
            value: { pitch: 1, yaw: 2, roll: 0 },
          },
          weapon: { availability: "unavailable", reason: "not networked" },
        },
      ],
    },
  ],
};

const reference = (position = 10.02): PlaybackReference => ({
  ...observed,
  producer: "licensed-playback-reference",
  gameBuildId: "steam-manifest-123",
  mapAssetId: "sha256:map",
  instrumentationVersion: "capture-1",
  tolerances: { positionUnits: 0.03125, eyeAngleDegrees: 0.01 },
  checkpoints: [
    {
      ...observed.checkpoints[0]!,
      players: [
        {
          ...observed.checkpoints[0]!.players[0]!,
          position: {
            availability: "observed",
            value: { x: position, y: 20, z: 30 },
          },
        },
      ],
    },
  ],
});

describe("playback validation", () => {
  it.runIf(existsSync(corpusDemo))(
    "exports selected checkpoints from the native prepared projection",
    async () => {
      const prepared = await prepareNativeDemoProjection(
        readFileSync(corpusDemo),
        { pseudonymKey: "l4dstats-playback-validation-v1" },
      );
      const tick = prepared.observations[0]!.observation.tick;
      const exported = exportPlaybackCheckpoints(prepared, {
        schemaVersion: 1,
        ticks: [tick],
        l4dstatsRevision: "native-test",
      });
      expect(exported.demoSha256).toBe(prepared.demoSha256);
      expect(exported.mapName).toBe(prepared.header.mapName);
      expect(exported.checkpoints[0]?.players.length).toBeGreaterThan(0);
      expect(
        exportPlaybackCheckpoints(prepared, {
          schemaVersion: 1,
          ticks: [tick],
          l4dstatsRevision: "native-test",
          tickIntervalSeconds: 0.01,
        }),
      ).toEqual(exported);
    },
    120_000,
  );
  it("normalizes and validates export requests", () => {
    expect(
      parsePlaybackExportRequest({
        schemaVersion: 1,
        ticks: [9, 3, 9],
        l4dstatsRevision: "abc123",
      }).ticks,
    ).toEqual([3, 9]);
    expect(() =>
      parsePlaybackExportRequest({
        schemaVersion: 1,
        ticks: [],
        l4dstatsRevision: "x",
      }),
    ).toThrow(/ticks/);
  });

  it("passes values inside declared tolerances and records input hashes", () => {
    const expected = reference();
    const observedBytes = bytes(observed);
    const referenceBytes = bytes(expected);
    const report = comparePlaybackCheckpoints(
      observed,
      expected,
      observedBytes,
      referenceBytes,
    );
    expect(report.passed).toBe(true);
    expect(report.differences).toEqual([]);
    expect(report.l4dstatsExportSha256).toBe(hash(observedBytes));
    expect(report.referenceSha256).toBe(hash(referenceBytes));
  });

  it("fails deterministically outside tolerance and on extra players", () => {
    const expected = reference(10.04);
    const extra = structuredClone(observed);
    const checkpoint = extra.checkpoints[0]!;
    (checkpoint.players as (typeof checkpoint.players)[number][]).push({
      ...checkpoint.players[0]!,
      playerEpochId: `${"a".repeat(64)}:4:1`,
      entitySlot: 4,
      lifetime: 1,
    });
    const report = comparePlaybackCheckpoints(
      extra,
      expected,
      bytes(extra),
      bytes(expected),
    );
    expect(report.passed).toBe(false);
    expect(report.differences.map(({ field }) => field)).toEqual([
      "position",
      "player",
    ]);
    expect(report.differences[0]?.tolerance).toBe(0.03125);
  });

  it("rejects provenance mismatches before comparing state", () => {
    expect(() =>
      comparePlaybackCheckpoints(
        observed,
        { ...reference(), demoSha256: "b".repeat(64) },
        bytes(observed),
        bytes(reference()),
      ),
    ).toThrow(/demo hashes/);
  });

  it("rejects malformed or copy-derived reference structure", () => {
    expect(() =>
      comparePlaybackCheckpoints(
        observed,
        { ...reference(), instrumentationVersion: "" },
        bytes(observed),
        bytes(reference()),
      ),
    ).toThrow(/instrumentationVersion/);
    expect(() =>
      comparePlaybackCheckpoints(
        observed,
        { ...reference(), selectedTicks: [99] },
        bytes(observed),
        bytes(reference()),
      ),
    ).toThrow(/checkpoints must match selected ticks/);
    expect(() =>
      comparePlaybackCheckpoints(
        observed,
        { ...reference(), checkpoints: [] },
        bytes(observed),
        bytes(reference()),
      ),
    ).toThrow(/checkpoints must match selected ticks/);
    const base = reference();
    const malformed = {
      ...base,
      checkpoints: [
        {
          ...base.checkpoints[0]!,
          players: [
            {
              ...base.checkpoints[0]!.players[0]!,
              team: { availability: "observed" as const },
            },
          ],
        },
      ],
    };
    expect(() =>
      comparePlaybackCheckpoints(
        observed,
        malformed,
        bytes(observed),
        bytes(malformed),
      ),
    ).toThrow(/invalid available value/);
    const wrongShape = structuredClone(reference());
    const wrongPlayer = wrongShape.checkpoints[0]!.players[0]!;
    (
      wrongPlayer as unknown as {
        position: { availability: "observed"; value: unknown };
      }
    ).position = { availability: "observed", value: {} };
    expect(() =>
      comparePlaybackCheckpoints(
        observed,
        wrongShape,
        bytes(observed),
        bytes(wrongShape),
      ),
    ).toThrow(/position has an invalid available value/);
  });
});
