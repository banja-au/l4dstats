import { describe, expect, it } from "vitest";
import { measureCoordinateAlignment } from "./alignment.js";

describe("demo and map coordinate alignment", () => {
  it("counts points inside three-dimensional mesh bounds", () => {
    expect(
      measureCoordinateAlignment(
        [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 5, z: 2 },
          { x: 11, y: 5, z: 2 },
        ],
        { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
      ),
    ).toMatchObject({ observed: 3, inside: 2, insideRate: 2 / 3 });
  });

  it("does not manufacture a rate for missing position telemetry", () => {
    expect(
      measureCoordinateAlignment([], {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
      }),
    ).toEqual({
      observed: 0,
      inside: 0,
      insideRate: null,
      observedBounds: null,
    });
  });
});
