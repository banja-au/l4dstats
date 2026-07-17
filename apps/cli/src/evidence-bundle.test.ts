import { describe, expect, it } from "vitest";
import type { ProjectedPlayerObservation } from "@witchwatch/l4d2-schema";
import { buildBoundedContextWindow } from "./evidence-bundle";

describe("evidence bundle windows", () => {
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
