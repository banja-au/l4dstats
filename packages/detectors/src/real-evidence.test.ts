import { createHash } from "node:crypto";
import type {
  PlayerObservation,
  ProjectedPlayerObservation,
} from "@witchwatch/contracts";
import { describe, expect, it } from "vitest";
import {
  buildRealAimEvidence,
  canonicalJson,
  sha256Canonical,
} from "./real-evidence.js";

const demoSha256 = "a".repeat(64);
const field = <T>(value: T) => ({ availability: "observed" as const, value });
const observation = (
  playerEpochId: string,
  tick: number,
  team: number,
  position: { x: number; y: number; z: number },
  yaw = 0,
): ProjectedPlayerObservation => ({
  observation: {
    schemaVersion: 1,
    demoSha256,
    playerEpochId,
    tick,
    demoTimeSeconds: field(tick / 100),
    position: field(position),
    eyeAngles: field({ pitch: 0, yaw, roll: 0 }),
    team: field(team),
    playerClass: field("fixture"),
    weapon: { availability: "unavailable", reason: "fixture" },
    buttons: { availability: "unavailable", reason: "fixture" },
  },
  l4d2: { entityIndex: 1 },
  provenance: {} as ProjectedPlayerObservation["provenance"],
});

describe("real projected observation evidence", () => {
  it("selects nearest opposing targets deterministically and hashes exact inputs", () => {
    const observations = [
      observation("player", 1, 2, { x: 0, y: 0, z: 0 }),
      observation("far", 1, 3, { x: 20, y: 0, z: 0 }),
      observation("near", 1, 3, { x: 10, y: 0, z: 0 }),
      observation("player", 2, 2, { x: 0, y: 0, z: 0 }),
      observation("near", 2, 3, { x: 11, y: 0, z: 0 }),
      observation("far", 2, 3, { x: 20, y: 0, z: 0 }),
    ];
    const first = buildRealAimEvidence({ demoSha256, observations });
    const second = buildRealAimEvidence({
      demoSha256,
      observations: [...observations].reverse(),
    });
    expect(first).toEqual(second);
    expect(first.artifact.observationArtifactSha256).toMatch(/^[a-f\d]{64}$/);
    expect(first.evidenceArtifactSha256).toMatch(/^[a-f\d]{64}$/);
    expect(
      first.artifact.players.find(
        ({ playerEpochId }) => playerEpochId === "player",
      ),
    ).toMatchObject({
      sampleCount: 2,
      completeSampleCount: 2,
      result: { evidence: [], skipped: [{ code: "missing-prerequisite" }] },
    });
  });

  it("never manufactures a target or unavailable source field", () => {
    const solo = observation("solo", 1, 2, { x: 0, y: 0, z: 0 });
    const unavailableTime: PlayerObservation = {
      ...solo.observation,
      demoTimeSeconds: {
        availability: "unavailable",
        reason: "no tick interval",
      },
    };
    const result = buildRealAimEvidence({
      demoSha256,
      observations: [solo, { ...solo, observation: unavailableTime }],
    });
    expect(result.artifact.players[0]).toMatchObject({
      completeSampleCount: 0,
      result: {
        evidence: [],
        skipped: [
          {
            code: "missing-prerequisite",
            unavailableFields: expect.arrayContaining([
              "timeSeconds",
              "targetPosition",
            ]),
          },
        ],
      },
    });
    expect(canonicalJson({ b: -0, a: 1 })).toBe('{"a":1,"b":0}');
    expect(sha256Canonical({ b: -0, a: 1 })).toBe(
      createHash("sha256").update('{"a":1,"b":0}').digest("hex"),
    );
  });

  it("rejects observations from a different demo hash rather than dropping them", () => {
    const row = observation("player", 1, 2, { x: 0, y: 0, z: 0 });
    expect(() =>
      buildRealAimEvidence({
        demoSha256: "b".repeat(64),
        observations: [row],
      }),
    ).toThrow(/demo hash/);
  });
});
