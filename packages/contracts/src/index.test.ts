import { describe, expect, it } from "vitest";
import { evidenceKinds } from "./index";

describe("evidence contract", () => {
  it("keeps the detector taxonomy explicit", () => {
    expect(evidenceKinds).toEqual([
      "aim",
      "awareness",
      "movement",
      "invariant",
    ]);
  });
});
