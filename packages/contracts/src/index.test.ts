import { describe, expect, it } from "vitest";
import {
  evidenceKinds,
  evidenceSchemaVersion,
  observationSchemaVersion,
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
});
