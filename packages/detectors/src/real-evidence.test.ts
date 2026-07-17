import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PlayerObservation } from "@witchwatch/contracts";
import {
  projectL4d2PlayerObservations,
  type ProjectedPlayerObservation,
} from "@witchwatch/l4d2-schema";
import { decodeDemo } from "@witchwatch/demo-source1";
import { describe, expect, it } from "vitest";
import { buildRealAimEvidence, canonicalJson } from "./real-evidence.js";

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

const corpusDemo = resolve(
  "../../data/sprint-1-corpus/extracted/901780_c2m1_highway/901780_c2m1_highway.dem",
);

describe.runIf(existsSync(corpusDemo))(
  "real-corpus detector integration",
  () => {
    it("produces byte-reproducible evidence or structured skips", () => {
      const bytes = readFileSync(corpusDemo);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const header = decodeDemo(bytes).header;
      const projected: ProjectedPlayerObservation[] = [];
      projectL4d2PlayerObservations(bytes, {
        demoSha256: hash,
        tickIntervalSeconds: header.playbackTimeSeconds / header.playbackTicks,
        userInfo: [],
        onObservation: (value) => projected.push(value),
      });
      const first = buildRealAimEvidence({
        demoSha256: hash,
        observations: projected,
      });
      const second = buildRealAimEvidence({
        demoSha256: hash,
        observations: projected,
      });
      expect(second).toEqual(first);
      expect(first.artifact.players.length).toBeGreaterThanOrEqual(8);
      expect(
        first.artifact.players.every(({ sampleCount }) => sampleCount > 0),
      ).toBe(true);
      expect(
        first.artifact.players.every(
          ({ result }) =>
            result.evidence.length > 0 || result.skipped.length > 0,
        ),
      ).toBe(true);
      expect(first.evidenceArtifactSha256).toMatch(/^[a-f\d]{64}$/);
      console.info("real evidence artifact", {
        demoSha256: hash,
        observationArtifactSha256: first.artifact.observationArtifactSha256,
        evidenceArtifactSha256: first.evidenceArtifactSha256,
        projectedObservations: projected.length,
        players: first.artifact.players.length,
        completeSamples: first.artifact.players.reduce(
          (count, player) => count + player.completeSampleCount,
          0,
        ),
        evidence: first.artifact.players.reduce(
          (count, player) => count + player.result.evidence.length,
          0,
        ),
        skipCodes: Object.fromEntries(
          first.artifact.players
            .flatMap((player) => player.result.skipped)
            .reduce((counts, skip) => {
              counts.set(skip.code, (counts.get(skip.code) ?? 0) + 1);
              return counts;
            }, new Map<string, number>()),
        ),
      });
    }, 300_000);
  },
);
