import { describe, expect, it } from "vitest";
import {
  buildNormalizedDensityGrid,
  densityDifference,
} from "./spatial-density";

const bounds = { min: { x: 0, y: 0 }, max: { x: 1_000, y: 1_000 } };

describe("normalized spatial density", () => {
  it("is invariant to duplicating every cohort sample", () => {
    const once = buildNormalizedDensityGrid(
      [{ x: 300, y: 400 }],
      bounds,
      32,
      32,
      128,
    );
    const repeated = buildNormalizedDensityGrid(
      Array.from({ length: 20 }, () => ({ x: 300, y: 400 })),
      bounds,
      32,
      32,
      128,
    );
    expect(
      [...repeated.values].every(
        (value, index) => Math.abs(value - (once.values[index] ?? 0)) < 1e-6,
      ),
    ).toBe(true);
  });

  it("uses world-space bandwidth independent of any viewport", () => {
    const density = buildNormalizedDensityGrid(
      [
        { x: 100, y: 100 },
        { x: 900, y: 900 },
      ],
      bounds,
      20,
      20,
      256,
    );
    expect(density.sampleCount).toBe(2);
    expect(density.maximum).toBeGreaterThan(0);
    expect(density.values).toHaveLength(400);
  });

  it("produces an antisymmetric A minus B surface", () => {
    const a = buildNormalizedDensityGrid(
      [{ x: 200, y: 200 }],
      bounds,
      16,
      16,
      128,
    );
    const b = buildNormalizedDensityGrid(
      [{ x: 800, y: 800 }],
      bounds,
      16,
      16,
      128,
    );
    const ab = densityDifference(a, b);
    const ba = densityDifference(b, a);
    expect([...ab].every((value, index) => value === -(ba[index] ?? 0))).toBe(
      true,
    );
  });
});
