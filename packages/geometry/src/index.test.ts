import { describe, expect, it } from "vitest";
import {
  angularDifference,
  audibilityProxy,
  directionFromAngles,
  locateFloor,
  normalize,
  overviewToWorld,
  priorSightingKnowledge,
  segmentIntersectsAabb,
  tickToDemoTime,
  traceVisibility,
  worldToOverview,
  type Aabb,
  type MapFloor,
} from "./index";

const box: Aabb = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
describe("vector and angle helpers", () => {
  it("handles wraparound and zero vectors", () => {
    expect(angularDifference(179, -179)).toBe(2);
    expect(normalize({ x: 0, y: 0, z: 0 })).toBeUndefined();
  });
  it("converts Source-style pitch/yaw to a unit direction", () => {
    expect(directionFromAngles(0, 90)).toEqual(
      expect.objectContaining({
        x: expect.closeTo(0),
        y: expect.closeTo(1),
        z: expect.closeTo(0),
      }),
    );
  });
});
describe("segment/AABB truth table", () => {
  it.each([
    [
      "crosses",
      { start: { x: -2, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } },
      true,
    ],
    [
      "misses",
      { start: { x: -2, y: 2, z: 0 }, end: { x: 2, y: 2, z: 0 } },
      false,
    ],
    [
      "touches",
      { start: { x: -2, y: 1, z: 0 }, end: { x: 2, y: 1, z: 0 } },
      true,
    ],
    [
      "point inside",
      { start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } },
      true,
    ],
    [
      "point outside",
      { start: { x: 2, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } },
      false,
    ],
  ] as const)("%s", (_name, segment, expected) =>
    expect(segmentIntersectsAabb(segment, box)).toBe(expected),
  );
  it("is symmetric for adversarial segments", () => {
    for (let i = 0; i < 200; i++) {
      const a = {
        x: Math.sin(i) * 3,
        y: Math.cos(i * 2) * 3,
        z: Math.sin(i * 3) * 3,
      };
      const b = {
        x: Math.cos(i) * 3,
        y: Math.sin(i * 2) * 3,
        z: Math.cos(i * 3) * 3,
      };
      expect(segmentIntersectsAabb({ start: a, end: b }, box)).toBe(
        segmentIntersectsAabb({ start: b, end: a }, box),
      );
    }
  });
});
describe("visibility quality", () => {
  const ray = { start: { x: -2, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } };
  it("skips explicitly when map geometry is absent", () => {
    const result = traceVisibility(ray, {
      staticGeometryAvailable: false,
      dynamicStateAvailable: false,
    });
    expect(result).toMatchObject({ quality: "unavailable", blockedBy: [] });
    expect(result.visible).toBeUndefined();
  });
  it("reports partial static knowledge without pretending doors are known", () => {
    expect(
      traceVisibility(ray, {
        staticGeometryAvailable: true,
        dynamicStateAvailable: false,
        assetVersion: "fixture-map-v1",
        staticOccluders: [],
      }),
    ).toMatchObject({
      visible: true,
      quality: "partial",
      limitations: [expect.stringContaining("dynamic")],
    });
  });
  it("attributes authoritative static and dynamic blockers", () => {
    expect(
      traceVisibility(ray, {
        staticGeometryAvailable: true,
        dynamicStateAvailable: true,
        assetVersion: "fixture-map-v1",
        staticOccluders: [{ id: "wall", bounds: box }],
        dynamicOccluders: [{ id: "door", bounds: box }],
      }),
    ).toMatchObject({
      visible: false,
      quality: "authoritative",
      blockedBy: ["wall", "door"],
    });
  });
  it("rejects unversioned geometry as irreproducible", () => {
    expect(
      traceVisibility(ray, {
        staticGeometryAvailable: true,
        dynamicStateAvailable: true,
      }),
    ).toMatchObject({ quality: "unavailable" });
  });
});
describe("overview/floor transforms", () => {
  it("round trips rotations and Y flips", () => {
    const t = {
      origin: { x: 128, y: -32 },
      scale: 4,
      rotationDegrees: 37,
      flipY: true,
    };
    for (const p of [
      { x: 0, y: 0 },
      { x: -9.5, y: 100.2 },
    ]) {
      const roundTrip = overviewToWorld(worldToOverview(p, t), t);
      expect(roundTrip.x).toBeCloseTo(p.x, 10);
      expect(roundTrip.y).toBeCloseTo(p.y, 10);
    }
  });
  it("refuses invalid scales and ambiguous floors", () => {
    expect(() =>
      worldToOverview({ x: 0, y: 0 }, { origin: { x: 0, y: 0 }, scale: 0 }),
    ).toThrow(RangeError);
    const floors: MapFloor[] = [
      {
        id: "a",
        minZ: 0,
        maxZ: 10,
        transform: { origin: { x: 0, y: 0 }, scale: 1 },
      },
      {
        id: "b",
        minZ: 10,
        maxZ: 20,
        transform: { origin: { x: 0, y: 0 }, scale: 1 },
      },
    ];
    expect(locateFloor({ x: 0, y: 0, z: 10 }, floors)).toEqual({
      status: "ambiguous",
      floorIds: ["a", "b"],
    });
  });
});
describe("temporal context", () => {
  it("does not advance demo time through a pause", () => {
    expect(
      tickToDemoTime(110, [
        {
          startTick: 100,
          endTick: 120,
          startDemoSeconds: 4,
          secondsPerTick: 1 / 30,
          paused: true,
        },
      ]),
    ).toEqual({ status: "available", demoSeconds: 4, quality: "observed" });
  });
  it("never extrapolates across missing clock segments", () => {
    expect(
      tickToDemoTime(99, [
        {
          startTick: 100,
          endTick: 120,
          startDemoSeconds: 4,
          secondsPerTick: 1 / 30,
        },
      ]),
    ).toMatchObject({ status: "unavailable" });
  });
  it("uses only prior, quality-qualified sightings within the window", () => {
    const sightings = [
      {
        observerId: "o",
        targetId: "t",
        tick: 90,
        quality: "authoritative" as const,
      },
      {
        observerId: "o",
        targetId: "t",
        tick: 101,
        quality: "authoritative" as const,
      },
    ];
    expect(priorSightingKnowledge("o", "t", 100, 10, sightings)).toMatchObject({
      known: true,
      ageTicks: 10,
    });
    expect(priorSightingKnowledge("o", "t", 100, 9, sightings)).toMatchObject({
      known: false,
      ageTicks: 10,
    });
  });
});
describe("audibility proxy", () => {
  it("is unavailable unless every proxy prerequisite is explicit", () => {
    expect(audibilityProxy({ eventAuthoritative: false })).toMatchObject({
      status: "unavailable",
    });
    expect(
      audibilityProxy({
        eventAuthoritative: true,
        source: { x: 0, y: 0, z: 0 },
        listener: { x: 1, y: 0, z: 0 },
        maxDistance: 2,
      }),
    ).toMatchObject({ status: "unavailable" });
  });
  it("labels distance-only results as a limited proxy", () => {
    expect(
      audibilityProxy({
        eventAuthoritative: true,
        source: { x: 0, y: 0, z: 0 },
        listener: { x: 3, y: 4, z: 0 },
        maxDistance: 5,
        attenuationModelVersion: "fixture-v1",
      }),
    ).toMatchObject({
      status: "available",
      audible: true,
      distance: 5,
      quality: "proxy",
      limitations: [expect.stringContaining("does not model")],
    });
  });
  it("rejects non-finite position telemetry", () => {
    expect(
      audibilityProxy({
        eventAuthoritative: true,
        source: { x: Number.NaN, y: 0, z: 0 },
        listener: { x: 0, y: 0, z: 0 },
        maxDistance: 10,
        attenuationModelVersion: "fixture-v1",
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("invalid"),
    });
  });
});
