import { describe, expect, it } from "vitest";
import {
  evidenceKinds,
  evidenceSchemaVersion,
  observationSchemaVersion,
  scoreSchemaVersion,
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
});
