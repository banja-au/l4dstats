import { bench, describe } from "vitest";
import { createAimDetector } from "./aim.js";
import type { DetectorContext, Field, Sample } from "./types.js";

const observed = <T>(value: T): Field<T> => ({
  availability: "observed",
  value,
});
const samples: Sample[] = Array.from({ length: 100_000 }, (_, tick) => ({
  tick,
  timeSeconds: observed(tick / 30),
  eyeAngles: observed({ pitch: Math.sin(tick / 20), yaw: tick % 360 }),
  playerPosition: observed({ x: tick, y: 0, z: 0 }),
  targetPosition: observed({ x: tick + 100, y: 100, z: 0 }),
  shot: observed(tick % 30 === 0),
  targetVisible: observed(true),
  targetAudible: observed(false),
  targetPreviouslyKnown: observed(false),
}));
const context: DetectorContext = {
  playerEpochId: "benchmark",
  provenance: {
    demoSha256: "a".repeat(64),
    observationArtifactSha256: "b".repeat(64),
    observationSchemaVersion: 1,
    configSha256: "c".repeat(64),
  },
};

describe("detector throughput", () => {
  bench(
    "aim dynamics / 100k samples",
    () => {
      createAimDetector().run(samples, context);
    },
    { iterations: 3, time: 100 },
  );
});
