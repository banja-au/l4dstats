import { describe, expect, it } from "vitest";
import { aimCard, createAimDetector } from "./aim.js";
import { createAwarenessDetector } from "./awareness.js";
import { segmentEncounters } from "./encounters.js";
import { fireCadenceDetector, movementDetector } from "./invariants.js";
import { angularDelta, wrapDegrees } from "./math.js";
import { DetectorRegistry } from "./registry.js";
import { evidenceSchemaVersion } from "./types.js";
import type {
  Angles,
  DetectorContext,
  EvidenceWindow,
  Field,
  Sample,
} from "./types.js";

const observed = <T>(value: T): Field<T> => ({
  availability: "observed",
  value,
});
const unavailable = <T>(reason = "fixture omitted field"): Field<T> => ({
  availability: "unavailable",
  reason,
});
const context: DetectorContext = {
  playerEpochId: "fixture-player-epoch",
  provenance: {
    demoSha256: "a".repeat(64),
    observationArtifactSha256: "b".repeat(64),
    observationSchemaVersion: 1,
    configSha256: "c".repeat(64),
  },
};

const sample = (
  tick: number,
  time: number,
  yaw: number,
  shot = false,
): Sample => ({
  tick,
  timeSeconds: observed(time),
  eyeAngles: observed({ pitch: 0, yaw }),
  playerPosition: observed({ x: 0, y: 0, z: 0 }),
  targetPosition: observed({ x: 0, y: 100, z: 0 }),
  shot: observed(shot),
  targetVisible: observed(true),
  targetAudible: observed(false),
  targetPreviouslyKnown: observed(false),
});

describe("angle math", () => {
  it("takes the short path across the yaw seam", () =>
    expect(
      angularDelta({ pitch: 0, yaw: 179 }, { pitch: 0, yaw: -179 }).yaw,
    ).toBe(2));
  it("always wraps finite generated angles into [-180, 180)", () => {
    let state = 123456789;
    for (let i = 0; i < 10_000; i++) {
      state = (1664525 * state + 1013904223) >>> 0;
      const value = (state - 2 ** 31) * 1000;
      const wrapped = wrapDegrees(value);
      expect(wrapped).toBeGreaterThanOrEqual(-180);
      expect(wrapped).toBeLessThan(180);
    }
  });
});

describe("aim dynamics", () => {
  it("emits reproducible raw dynamics, counterevidence, and provenance for a synthetic snap", () => {
    const inputs = [
      sample(1, 0, 0),
      sample(2, 0.05, 0),
      sample(3, 0.1, 20),
      sample(4, 0.12, 89, true),
      sample(5, 0.17, 90),
    ];
    const first = createAimDetector().run(inputs, context),
      second = createAimDetector().run(inputs, context);
    expect(first).toEqual(second);
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(first.evidence[0]).toMatchObject({
      tickRange: { start: 3, end: 5 },
      provenance: { detectorId: aimCard.id, detectorVersion: aimCard.version },
    });
    expect(first.evidence[0]!.rawFeatures).toHaveProperty(
      "jerkDegreesPerSecondCubed",
    );
    expect(first.evidence[0]!.counterevidence).toContain(
      "A fast human flick can produce the same local shape.",
    );
  });
  it("keeps a fast but off-target human flick as a hard negative", () => {
    const inputs = [
      sample(1, 0, 0),
      sample(2, 0.05, 0),
      sample(3, 0.1, -80),
      sample(4, 0.12, -40),
      sample(5, 0.17, -30),
    ];
    expect(createAimDetector().run(inputs, context).evidence).toEqual([]);
  });
  it("does not impute missing angles", () => {
    const inputs = [1, 2, 3, 4].map((tick) => ({
      ...sample(tick, tick / 20, 0),
      eyeAngles: unavailable<Angles>("entity property absent"),
    }));
    expect(createAimDetector().run(inputs, context)).toMatchObject({
      evidence: [],
      skipped: [
        { code: "missing-prerequisite", unavailableFields: ["eyeAngles"] },
      ],
    });
  });
  it("rejects duplicated/non-monotonic time instead of creating infinite speed", () => {
    const inputs = [
      sample(1, 1, 0),
      sample(2, 1, 90),
      sample(3, 0.9, 90),
      sample(4, 1, 90),
    ];
    expect(createAimDetector().run(inputs, context).evidence).toEqual([]);
  });
});

describe("authoritative context detectors", () => {
  it("awareness skips without authoritative visibility and information inputs", () => {
    const audit = {
      tick: 10,
      alignmentDegrees: observed(1),
      lineOfSight: observed(false),
      lineOfSightAuthority: unavailable<"bsp-trace" | "engine-event">("no map"),
      audible: observed(false),
      previouslyKnown: observed(false),
      dynamicOccludersResolved: observed(true),
    };
    expect(createAwarenessDetector().run([audit], context)).toMatchObject({
      evidence: [],
      skipped: [
        {
          code: "missing-prerequisite",
          unavailableFields: ["lineOfSightAuthority"],
        },
      ],
    });
  });
  it("does not flag visible, audible, or previously known targets", () => {
    const base = {
      tick: 10,
      alignmentDegrees: observed(1),
      lineOfSightAuthority: observed<"bsp-trace">("bsp-trace"),
      dynamicOccludersResolved: observed(true),
    };
    const audits = [
      {
        ...base,
        lineOfSight: observed(true),
        audible: observed(false),
        previouslyKnown: observed(false),
      },
      {
        ...base,
        lineOfSight: observed(false),
        audible: observed(true),
        previouslyKnown: observed(false),
      },
      {
        ...base,
        lineOfSight: observed(false),
        audible: observed(false),
        previouslyKnown: observed(true),
      },
    ];
    expect(createAwarenessDetector().run(audits, context).evidence).toEqual([]);
  });
  it("emits an audited hidden alignment with limitations", () => {
    const audit = {
      tick: 10,
      alignmentDegrees: observed(1),
      lineOfSight: observed(false),
      lineOfSightAuthority: observed<"bsp-trace">("bsp-trace"),
      audible: observed(false),
      previouslyKnown: observed(false),
      dynamicOccludersResolved: observed(true),
    };
    const finding = createAwarenessDetector().run([audit], context)
      .evidence[0]!;
    expect(finding.rawFeatures).toMatchObject({
      lineOfSight: false,
      audible: false,
    });
    expect(finding.limitations.length).toBeGreaterThan(0);
  });
  it("requires authoritative ammo and weapon state for cadence", () => {
    const fire = (tick: number, time: number, authority: boolean) => ({
      tick,
      timeSeconds: observed(time),
      fired: observed(true),
      weaponId: observed("rifle"),
      minimumCycleSeconds: observed(0.1),
      ammoBefore: observed(30),
      ammoAfter: observed(29),
      stateAuthoritative: observed(authority),
    });
    expect(
      fireCadenceDetector.run(
        [fire(1, 0, false), fire(2, 0.01, false)],
        context,
      ).evidence,
    ).toEqual([]);
    expect(
      fireCadenceDetector.run([fire(1, 0, true), fire(2, 0.01, true)], context)
        .evidence[0]!.effect.unit,
    ).toBe("seconds below minimum cycle");
  });
  it("requires authoritative movement state", () => {
    const row = (authority: boolean) => ({
      tick: 1,
      speed: observed(400),
      allowedSpeed: observed(220),
      movementMode: observed("grounded"),
      stateAuthoritative: observed(authority),
    });
    expect(movementDetector.run([row(false)], context).evidence).toEqual([]);
    expect(movementDetector.run([row(true)], context).evidence).toHaveLength(1);
  });
});

const window = (
  id: string,
  tick: number,
  detector = "aim-dynamics",
): EvidenceWindow => ({
  schemaVersion: evidenceSchemaVersion,
  id,
  playerEpochId: "p",
  kind: "aim",
  tickRange: { start: tick, end: tick },
  rawFeatures: {},
  effect: { value: tick, unit: "fixture", baseline: "fixture" },
  contributionPlaceholder: null,
  quality: { value: 1, basis: ["fixture"] },
  explanation: "fixture",
  limitations: ["fixture"],
  counterevidence: ["fixture"],
  provenance: {
    ...context.provenance,
    detectorId: detector,
    detectorVersion: "1.0.0",
  },
});

describe("encounter segmentation", () => {
  it("collapses correlated ticks but separates detector causes", () => {
    const encounters = segmentEncounters(
      [window("b", 12), window("a", 10), window("c", 13, "other")],
      2,
    );
    expect(encounters).toHaveLength(2);
    expect(encounters[0]!.evidence.map((e) => e.id)).toEqual(["a", "b"]);
  });
  it("preserves every item exactly once for generated inputs", () => {
    for (let count = 0; count < 100; count++) {
      const inputs = Array.from({ length: count }, (_, i) =>
        window(String(i), (i * 17) % 53),
      );
      const flattened = segmentEncounters(inputs, 3)
        .flatMap((e) => e.evidence.map((w) => w.id))
        .sort();
      expect(flattened).toEqual(inputs.map((w) => w.id).sort());
    }
  });
  it("rejects invalid ranges and gaps", () => {
    expect(() => segmentEncounters([], -1)).toThrow(RangeError);
    expect(() =>
      segmentEncounters(
        [{ ...window("bad", 1), tickRange: { start: 2, end: 1 } }],
        1,
      ),
    ).toThrow(RangeError);
  });
});

describe("registry and detector cards", () => {
  it("versions registrations and rejects duplicates", () => {
    const detector = createAimDetector(),
      registry = new DetectorRegistry().register(detector);
    expect(registry.get(aimCard.id, aimCard.version)).toBeDefined();
    expect(() => registry.register(detector)).toThrow(/duplicate/);
    expect(registry.cards()[0]).toMatchObject({
      prerequisites: expect.any(Array),
      failureModes: expect.any(Array),
    });
  });
});
