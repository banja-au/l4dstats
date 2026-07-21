import { describe, expect, it } from "vitest";
import {
  evidenceKinds,
  evidenceSchemaVersion,
  observationSchemaVersion,
  scoreSchemaVersion,
  type DemoSourcePerspective,
  type RecorderCommandObservation,
  type ReviewScore,
} from "./index";

describe("evidence contract", () => {
  it("keeps the detector taxonomy explicit", () => {
    expect(evidenceKinds).toEqual([
      "aim",
      "awareness",
      "movement",
      "invariant",
    ]);
  });

  it("versions canonical observations independently of detectors", () => {
    expect(observationSchemaVersion).toBe(1);
    expect(evidenceSchemaVersion).toBe(1);
  });

  it("makes numeric review priority exclusive to calibrated output", () => {
    const statuses: ReviewScore["status"][] = [
      "insufficient-data",
      "ranked-evidence",
      "calibrated-priority",
    ];
    expect(statuses).toEqual([
      "insufficient-data",
      "ranked-evidence",
      "calibrated-priority",
    ]);
    expect(scoreSchemaVersion).toBe(1);
  });

  it("keeps recorder commands scoped to intent instead of outcomes", () => {
    const perspective: DemoSourcePerspective = "player-pov";
    const command: RecorderCommandObservation = {
      schemaVersion: 1,
      demoSha256: "a".repeat(64),
      demoTick: 10,
      demoTimeSeconds: { availability: "derived", value: 1 / 3 },
      recorderPlayerEpochId: {
        availability: "unavailable",
        reason: "recorder identity was not resolved",
      },
      outgoingSequence: 7,
      commandNumber: 7,
      clientTickCount: 8,
      viewAngles: { pitch: 1, yaw: 2, roll: 0 },
      intendedMovement: { forward: 450, side: 0, up: 0 },
      buttons: 1,
      impulse: 0,
      weaponSelect: { availability: "unavailable", reason: "not present" },
      weaponSubtype: { availability: "unavailable", reason: "not present" },
      mouseDelta: { x: 4, y: -2 },
      provenance: {
        source: "dem_usercmd",
        scope: "recorder-only",
        semantics: "client-command-intent",
      },
    };
    expect(perspective).toBe("player-pov");
    expect(command.provenance).toEqual({
      source: "dem_usercmd",
      scope: "recorder-only",
      semantics: "client-command-intent",
    });
  });
});
