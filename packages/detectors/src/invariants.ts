import {
  present,
  evidenceSchemaVersion,
  provenanceFor,
  skipped,
  type Detector,
  type DetectorCard,
  type DetectorContext,
  type DetectorResult,
  type Field,
} from "./types.js";

export interface FireSample {
  readonly tick: number;
  readonly timeSeconds: Field<number>;
  readonly fired: Field<boolean>;
  readonly weaponId: Field<string>;
  readonly minimumCycleSeconds: Field<number>;
  readonly ammoBefore: Field<number>;
  readonly ammoAfter: Field<number>;
  readonly stateAuthoritative: Field<boolean>;
}
export interface MovementSample {
  readonly tick: number;
  readonly speed: Field<number>;
  readonly allowedSpeed: Field<number>;
  readonly movementMode: Field<string>;
  readonly stateAuthoritative: Field<boolean>;
}

export const fireCadenceCard: DetectorCard = {
  id: "fire-cadence-invariant",
  version: "1.0.0",
  title: "Authoritative fire cadence invariant",
  kind: "invariant",
  prerequisites: [
    "authoritative weapon state",
    "shot time",
    "weapon cycle time",
    "ammo transition",
  ],
  failureModes: [
    "weapon upgrades or mode changes absent from state",
    "tick quantization",
    "event duplication",
  ],
  interpretation:
    "Reports a cycle-time violation only when weapon and ammo state are authoritative.",
};
export const movementCard: DetectorCard = {
  id: "movement-invariant",
  version: "1.0.0",
  title: "Authoritative movement invariant",
  kind: "movement",
  prerequisites: [
    "authoritative movement mode",
    "observed speed",
    "mode-specific allowed speed",
  ],
  failureModes: [
    "knockback or map triggers",
    "unmodeled temporary modifiers",
    "teleports",
  ],
  interpretation:
    "Reports speed beyond the authoritative state-specific bound; it is an engine-data consistency check.",
};

export const fireCadenceDetector: Detector<readonly FireSample[]> = {
  card: fireCadenceCard,
  run(samples, context): DetectorResult {
    const complete = samples.filter(
      (s) =>
        [
          s.timeSeconds,
          s.fired,
          s.weaponId,
          s.minimumCycleSeconds,
          s.ammoBefore,
          s.ammoAfter,
          s.stateAuthoritative,
        ].every(
          (field) =>
            field.availability !== "unavailable" && field.value !== undefined,
        ) && s.stateAuthoritative.value === true,
    );
    if (samples.length === 0)
      return skipped(
        fireCadenceCard.id,
        "empty-input",
        "No fire-state samples were supplied.",
      );
    if (complete.length < 2)
      return skipped(
        fireCadenceCard.id,
        "missing-prerequisite",
        "At least two complete authoritative fire samples are required.",
        ["time/shot/weapon/cycle/ammo/authority"],
      );
    const shots = complete
      .filter(
        (s) =>
          s.fired.value &&
          s.stateAuthoritative.value &&
          s.ammoAfter.value === s.ammoBefore.value! - 1,
      )
      .sort((a, b) => a.timeSeconds.value! - b.timeSeconds.value!);
    const evidence = shots.slice(1).flatMap((shot, index) => {
      const previous = shots[index]!;
      if (previous.weaponId.value !== shot.weaponId.value) return [];
      const interval = shot.timeSeconds.value! - previous.timeSeconds.value!;
      const minimum = Math.max(
        previous.minimumCycleSeconds.value!,
        shot.minimumCycleSeconds.value!,
      );
      if (interval + 1e-9 >= minimum) return [];
      return [
        {
          schemaVersion: evidenceSchemaVersion,
          id: `${fireCadenceCard.id}:${context.playerEpochId}:${shot.tick}`,
          playerEpochId: context.playerEpochId,
          kind: "invariant" as const,
          tickRange: { start: previous.tick, end: shot.tick },
          rawFeatures: {
            intervalSeconds: interval,
            minimumCycleSeconds: minimum,
            weaponId: shot.weaponId.value!,
            ammoDelta: shot.ammoAfter.value! - shot.ammoBefore.value!,
          },
          effect: {
            value: minimum - interval,
            unit: "seconds below minimum cycle",
            baseline: "authoritative weapon cycle time",
          },
          contributionPlaceholder: null,
          quality: {
            value: 0.95,
            basis: [
              "authoritative state",
              "matching weapon",
              "consistent ammo transitions",
            ],
          },
          explanation: `Two authoritative ${shot.weaponId.value!} fire events were ${interval.toFixed(4)}s apart, below its ${minimum.toFixed(4)}s cycle.`,
          limitations: fireCadenceCard.failureModes,
          counterevidence: [
            "A parser duplication or incomplete weapon-mode model can mimic this violation.",
          ],
          provenance: provenanceFor(context, fireCadenceCard),
        },
      ];
    });
    return evidence.length
      ? { evidence, skipped: [] }
      : skipped(
          fireCadenceCard.id,
          "no-candidate",
          "No authoritative cadence violation was present.",
        );
  },
};

export const movementDetector: Detector<readonly MovementSample[]> = {
  card: movementCard,
  run(samples, context): DetectorResult {
    if (samples.length === 0)
      return skipped(
        movementCard.id,
        "empty-input",
        "No movement-state samples were supplied.",
      );
    const complete = samples.filter(
      (s) =>
        [s.speed, s.allowedSpeed, s.movementMode, s.stateAuthoritative].every(
          (field) =>
            field.availability !== "unavailable" && field.value !== undefined,
        ) && s.stateAuthoritative.value === true,
    );
    if (complete.length === 0)
      return skipped(
        movementCard.id,
        "missing-prerequisite",
        "No complete authoritative movement state was supplied.",
        ["speed/allowedSpeed/movementMode/authority"],
      );
    const evidence = complete
      .filter(
        (s) =>
          s.stateAuthoritative.value &&
          s.speed.value! > s.allowedSpeed.value! + 1e-9,
      )
      .map((s) => ({
        schemaVersion: evidenceSchemaVersion,
        id: `${movementCard.id}:${context.playerEpochId}:${s.tick}`,
        playerEpochId: context.playerEpochId,
        kind: "movement" as const,
        tickRange: { start: s.tick, end: s.tick },
        rawFeatures: {
          speed: s.speed.value!,
          allowedSpeed: s.allowedSpeed.value!,
          movementMode: s.movementMode.value!,
        },
        effect: {
          value: s.speed.value! - s.allowedSpeed.value!,
          unit: "world units/second above bound",
          baseline: "authoritative mode-specific movement bound",
        },
        contributionPlaceholder: null,
        quality: {
          value: 0.9,
          basis: ["authoritative movement state", "mode-specific bound"],
        },
        explanation: `Observed speed ${s.speed.value!.toFixed(2)} exceeded the ${s.movementMode.value!} bound ${s.allowedSpeed.value!.toFixed(2)}.`,
        limitations: movementCard.failureModes,
        counterevidence: [
          "An unmodeled impulse, trigger, or temporary modifier may explain the excess.",
        ],
        provenance: provenanceFor(context, movementCard),
      }));
    return evidence.length
      ? { evidence, skipped: [] }
      : skipped(
          movementCard.id,
          "no-candidate",
          "No authoritative movement invariant violation was present.",
        );
  },
};
