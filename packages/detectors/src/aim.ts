import { anglesTo, angularDelta, angularDistance } from "./math.js";
import {
  present,
  evidenceSchemaVersion,
  provenanceFor,
  skipped,
  type Detector,
  type DetectorCard,
  type DetectorContext,
  type DetectorResult,
  type Sample,
} from "./types.js";

export interface AimConfig {
  readonly minimumSamples: number;
  readonly minimumSnapSpeedDegreesPerSecond: number;
  readonly minimumJerkDegreesPerSecondCubed: number;
  readonly maximumPostSnapErrorDegrees: number;
  readonly shotWindowSeconds: number;
}

export const defaultAimConfig: AimConfig = {
  minimumSamples: 4,
  minimumSnapSpeedDegreesPerSecond: 700,
  minimumJerkDegreesPerSecondCubed: 20_000,
  maximumPostSnapErrorDegrees: 2,
  shotWindowSeconds: 0.12,
};

export const aimCard: DetectorCard = {
  id: "aim-dynamics",
  version: "1.0.0",
  title: "Server-observed aim dynamics",
  kind: "aim",
  prerequisites: [
    "monotonic demo time",
    "networked eye angles",
    "player and target position",
  ],
  failureModes: [
    "SourceTV quantization and interpolation",
    "low tick rate",
    "spectator state is not direct mouse input",
    "target selection uncertainty",
  ],
  interpretation:
    "Highlights a rapid acquisition with abrupt acceleration and low post-movement target error; it does not infer input method.",
};

interface Kinematic {
  readonly sample: Sample;
  readonly dt: number;
  readonly speed: number;
  readonly accel: number;
  readonly jerk: number;
  readonly error: number;
  readonly deltaPitch: number;
  readonly deltaYaw: number;
}

const availableRows = (samples: readonly Sample[]): readonly Sample[] =>
  samples
    .filter(
      (s) =>
        present(s.timeSeconds) &&
        present(s.eyeAngles) &&
        present(s.playerPosition) &&
        present(s.targetPosition),
    )
    .sort((a, b) => a.tick - b.tick);

export const computeAimKinematics = (
  samples: readonly Sample[],
): readonly Kinematic[] => {
  const rows = availableRows(samples);
  const output: Kinematic[] = [];
  let previousSpeed = 0,
    previousAccel = 0;
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!,
      sample = rows[i]!;
    const dt = sample.timeSeconds.value! - previous.timeSeconds.value!;
    if (!(dt > 0)) continue;
    const delta = angularDelta(
      previous.eyeAngles.value!,
      sample.eyeAngles.value!,
    );
    const speed = Math.hypot(delta.pitch, delta.yaw) / dt;
    const accel = (speed - previousSpeed) / dt;
    const jerk = (accel - previousAccel) / dt;
    const target = anglesTo(
      sample.playerPosition.value!,
      sample.targetPosition.value!,
    );
    output.push({
      sample,
      dt,
      speed,
      accel,
      jerk,
      error: angularDistance(sample.eyeAngles.value!, target),
      deltaPitch: delta.pitch,
      deltaYaw: delta.yaw,
    });
    previousSpeed = speed;
    previousAccel = accel;
  }
  return output;
};

const nearestShotSeconds = (
  candidate: Kinematic,
  samples: readonly Sample[],
): number | null => {
  const time = candidate.sample.timeSeconds.value!;
  const distances = samples
    .filter((s) => present(s.shot) && s.shot.value && present(s.timeSeconds))
    .map((s) => Math.abs(s.timeSeconds.value! - time));
  return distances.length === 0 ? null : Math.min(...distances);
};

export const createAimDetector = (
  config: AimConfig = defaultAimConfig,
): Detector<readonly Sample[]> => ({
  card: aimCard,
  run(samples: readonly Sample[], context: DetectorContext): DetectorResult {
    if (samples.length === 0)
      return skipped(
        aimCard.id,
        "empty-input",
        "No player samples were supplied.",
      );
    const missing = [
      "timeSeconds",
      "eyeAngles",
      "playerPosition",
      "targetPosition",
    ].filter((key) =>
      samples.some((s) => !present(s[key as keyof Sample] as never)),
    );
    const rows = availableRows(samples);
    if (rows.length < config.minimumSamples)
      return skipped(
        aimCard.id,
        "missing-prerequisite",
        `Only ${rows.length} complete samples; ${config.minimumSamples} are required.`,
        missing,
      );
    const kinematics = computeAimKinematics(rows);
    const candidates = kinematics.filter((k, index) => {
      const correction = kinematics[index + 1];
      const reverses =
        correction !== undefined &&
        k.deltaPitch * correction.deltaPitch +
          k.deltaYaw * correction.deltaYaw <
          0;
      const settles =
        correction !== undefined &&
        correction.speed <= k.speed * 0.5 &&
        correction.error <= config.maximumPostSnapErrorDegrees;
      return (
        k.speed >= config.minimumSnapSpeedDegreesPerSecond &&
        Math.abs(k.jerk) >= config.minimumJerkDegreesPerSecondCubed &&
        k.error <= config.maximumPostSnapErrorDegrees &&
        (reverses || settles)
      );
    });
    if (candidates.length === 0)
      return skipped(
        aimCard.id,
        "no-candidate",
        "No aim movement met the conservative dynamics and target-error prerequisites.",
      );
    const evidence = candidates.map((candidate) => {
      const index = rows.findIndex((s) => s.tick === candidate.sample.tick);
      const before = rows[Math.max(0, index - 1)]!;
      const after = rows[Math.min(rows.length - 1, index + 1)]!;
      const shotDistance = nearestShotSeconds(candidate, samples);
      const hasShotTiming =
        shotDistance !== null && shotDistance <= config.shotWindowSeconds;
      const beforeTarget = anglesTo(
        before.playerPosition.value!,
        before.targetPosition.value!,
      );
      const preAcquisitionError = angularDistance(
        before.eyeAngles.value!,
        beforeTarget,
      );
      const acquisitionSeconds =
        candidate.sample.timeSeconds.value! - before.timeSeconds.value!;
      const afterTarget = anglesTo(
        after.playerPosition.value!,
        after.targetPosition.value!,
      );
      const postCorrectionError = angularDistance(
        after.eyeAngles.value!,
        afterTarget,
      );
      const limitations = [
        ...aimCard.failureModes,
        ...(shotDistance === null
          ? ["Shot timing was unavailable; the window is aim-only."]
          : []),
      ];
      const counterevidence = [
        "A fast human flick can produce the same local shape.",
        ...(candidate.error > 1
          ? ["Residual target error is material rather than pixel-perfect."]
          : []),
        ...(!hasShotTiming
          ? ["No authoritative shot occurred near the acquisition."]
          : []),
      ];
      return {
        schemaVersion: evidenceSchemaVersion,
        id: `${aimCard.id}:${context.playerEpochId}:${candidate.sample.tick}`,
        playerEpochId: context.playerEpochId,
        kind: "aim" as const,
        tickRange: { start: before.tick, end: after.tick },
        rawFeatures: {
          speedDegreesPerSecond: candidate.speed,
          accelerationDegreesPerSecondSquared: candidate.accel,
          jerkDegreesPerSecondCubed: candidate.jerk,
          preAcquisitionErrorDegrees: preAcquisitionError,
          postMovementErrorDegrees: candidate.error,
          postCorrectionTrackingErrorDegrees: postCorrectionError,
          acquisitionSeconds,
          deltaPitchDegrees: candidate.deltaPitch,
          deltaYawDegrees: candidate.deltaYaw,
          nearestShotSeconds: shotDistance,
          shotWithinWindow: hasShotTiming,
        },
        effect: {
          value: candidate.speed,
          unit: "degrees/second",
          baseline: `local movement; candidate floor ${config.minimumSnapSpeedDegreesPerSecond} degrees/second`,
        },
        contributionPlaceholder: null,
        quality: {
          value: shotDistance === null ? 0.65 : 0.8,
          basis: [
            "complete angle/position/time window",
            shotDistance === null
              ? "shot timing unavailable"
              : "shot timing observed",
            "server-observed rather than direct input",
          ],
        },
        explanation: `View direction moved ${candidate.speed.toFixed(1)}°/s and ended ${candidate.error.toFixed(2)}° from the selected target${hasShotTiming ? " near an observed shot" : ""}.`,
        limitations,
        counterevidence,
        provenance: provenanceFor(context, aimCard),
      };
    });
    return {
      evidence,
      skipped: missing.length
        ? [
            {
              detectorId: aimCard.id,
              code: "missing-prerequisite",
              explanation:
                "Incomplete samples were excluded rather than imputed.",
              unavailableFields: missing,
            },
          ]
        : [],
    };
  },
});
