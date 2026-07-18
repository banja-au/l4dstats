import { createHash, type Hash } from "node:crypto";
import type { AvailableValue, PlayerObservation } from "@witchwatch/contracts";
import type { ProjectedPlayerObservation } from "@witchwatch/l4d2-schema";
import { createAimDetector, defaultAimConfig, type AimConfig } from "./aim.js";
import type { DetectorResult, Sample, Vector3 } from "./types.js";

const integrationVersion = "1.0.0" as const;
const targetSelectionRule = "nearest-opposing-player-at-same-tick-v1" as const;

export interface RealEvidenceOptions {
  readonly demoSha256: string;
  readonly observations: readonly ProjectedPlayerObservation[];
  readonly aimConfig?: AimConfig;
  readonly mapAssetSha256?: string;
}

export interface PlayerRealEvidence {
  readonly playerEpochId: string;
  readonly sampleCount: number;
  readonly completeSampleCount: number;
  readonly result: DetectorResult;
}

export interface RealEvidenceArtifact {
  readonly schemaVersion: 1;
  readonly integrationVersion: typeof integrationVersion;
  readonly demoSha256: string;
  readonly observationArtifactSha256: string;
  readonly configSha256: string;
  readonly targetSelectionRule: typeof targetSelectionRule;
  readonly players: readonly PlayerRealEvidence[];
}

export interface HashedRealEvidenceArtifact {
  /** Exact, canonicalizable detector inputs retained for independent reruns. */
  readonly observationArtifact: RealAimInputArtifact;
  readonly artifact: RealEvidenceArtifact;
  readonly evidenceArtifactSha256: string;
}

export interface RealAimInputArtifact {
  readonly integrationVersion: typeof integrationVersion;
  readonly demoSha256: string;
  readonly targetSelectionRule: typeof targetSelectionRule;
  /** Canonical source rows, including projection-property derivation lineage. */
  readonly sourceObservations: readonly ProjectedPlayerObservation[];
  readonly samplesByPlayer: Readonly<Record<string, readonly Sample[]>>;
}

/**
 * Builds aim-detector input only from canonical projection fields. Target
 * visibility, audibility, shot state, and prior knowledge remain unavailable:
 * the entity projection does not currently establish those facts.
 */
export function buildRealAimEvidence(
  options: RealEvidenceOptions,
): HashedRealEvidenceArtifact {
  assertSha256(options.demoSha256, "demoSha256");
  if (options.mapAssetSha256 !== undefined)
    assertSha256(options.mapAssetSha256, "mapAssetSha256");

  const config = options.aimConfig ?? defaultAimConfig;
  const normalized = normalizeInputs(options.demoSha256, options.observations);
  // Samples are a deterministic projection of these exact source rows under
  // targetSelectionRule. Hashing both copies made large SourceTV demos pay the
  // canonicalization cost twice without strengthening lineage.
  const observationArtifactSha256 = sha256Canonical({
    integrationVersion: normalized.integrationVersion,
    demoSha256: normalized.demoSha256,
    targetSelectionRule: normalized.targetSelectionRule,
    sourceObservations: normalized.sourceObservations,
  });
  const configSha256 = sha256Canonical({
    aimConfig: config,
    integrationVersion,
    targetSelectionRule,
  });
  const detector = createAimDetector(config);
  const players = Object.entries(normalized.samplesByPlayer).map(
    ([playerEpochId, samples]): PlayerRealEvidence => {
      const result = detector.run(samples, {
        playerEpochId,
        provenance: {
          demoSha256: options.demoSha256,
          observationArtifactSha256,
          observationSchemaVersion: 1,
          configSha256,
          ...(options.mapAssetSha256 === undefined
            ? {}
            : { mapAssetSha256: options.mapAssetSha256 }),
        },
      });
      return {
        playerEpochId,
        sampleCount: samples.length,
        completeSampleCount: samples.filter(isCompleteAimSample).length,
        result,
      };
    },
  );
  const artifact: RealEvidenceArtifact = {
    schemaVersion: 1,
    integrationVersion,
    demoSha256: options.demoSha256,
    observationArtifactSha256,
    configSha256,
    targetSelectionRule,
    players,
  };
  return {
    observationArtifact: normalized,
    artifact,
    evidenceArtifactSha256: sha256Canonical(artifact),
  };
}

function normalizeInputs(
  demoSha256: string,
  projected: readonly ProjectedPlayerObservation[],
): RealAimInputArtifact {
  const mismatched = projected.find(
    ({ observation }) => observation.demoSha256 !== demoSha256,
  );
  if (mismatched !== undefined)
    throw new RangeError(
      "projected observation demo hash does not match demoSha256",
    );
  const sourceObservations = [...projected].sort(
    (left, right) =>
      left.observation.tick - right.observation.tick ||
      left.observation.playerEpochId.localeCompare(
        right.observation.playerEpochId,
      ),
  );
  const observations = sourceObservations.map(({ observation }) => observation);
  observations.sort(
    (left, right) =>
      left.tick - right.tick ||
      left.playerEpochId.localeCompare(right.playerEpochId),
  );
  const ticks = new Map<number, PlayerObservation[]>();
  for (const observation of observations) {
    const atTick = ticks.get(observation.tick) ?? [];
    atTick.push(observation);
    ticks.set(observation.tick, atTick);
  }

  const samples = new Map<string, Sample[]>();
  for (const observation of observations) {
    const rows = samples.get(observation.playerEpochId) ?? [];
    rows.push(toSample(observation, ticks.get(observation.tick) ?? []));
    samples.set(observation.playerEpochId, rows);
  }
  return {
    integrationVersion,
    demoSha256,
    targetSelectionRule,
    sourceObservations,
    samplesByPlayer: Object.fromEntries(
      [...samples.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function toSample(
  player: PlayerObservation,
  atTick: readonly PlayerObservation[],
): Sample {
  const target = selectTarget(player, atTick);
  return {
    tick: player.tick,
    timeSeconds: player.demoTimeSeconds,
    eyeAngles:
      player.eyeAngles.value === undefined
        ? unavailable(
            player.eyeAngles.reason ?? "networked eye angles unavailable",
          )
        : {
            availability: player.eyeAngles.availability,
            value: {
              pitch: player.eyeAngles.value.pitch,
              yaw: player.eyeAngles.value.yaw,
            },
          },
    playerPosition: player.position,
    targetPosition: target,
    shot: unavailable("authoritative weapon-fire events were not projected"),
    targetVisible: unavailable("authoritative visibility was not established"),
    targetAudible: unavailable("authoritative audibility was not established"),
    targetPreviouslyKnown: unavailable(
      "authoritative prior knowledge was not established",
    ),
  };
}

function selectTarget(
  player: PlayerObservation,
  atTick: readonly PlayerObservation[],
): AvailableValue<Vector3> {
  if (player.position.value === undefined)
    return unavailable("player position was unavailable for target selection");
  if (player.team.value !== 2 && player.team.value !== 3)
    return unavailable("player was not on an opposing playable team (2 or 3)");
  const opposingTeam = player.team.value === 2 ? 3 : 2;
  const candidates = atTick
    .filter(
      (candidate) =>
        candidate.playerEpochId !== player.playerEpochId &&
        candidate.team.value === opposingTeam &&
        candidate.position.value !== undefined,
    )
    .map((candidate) => ({
      id: candidate.playerEpochId,
      position: candidate.position.value!,
      distanceSquared: squaredDistance(
        player.position.value!,
        candidate.position.value!,
      ),
    }))
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.id.localeCompare(right.id),
    );
  const target = candidates[0];
  return target === undefined
    ? unavailable("no positioned opposing player existed at the same tick")
    : { availability: "derived", value: target.position };
}

function squaredDistance(left: Vector3, right: Vector3): number {
  return (
    (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2
  );
}

function unavailable<T>(reason: string): AvailableValue<T> {
  return { availability: "unavailable", reason };
}

function isCompleteAimSample(sample: Sample): boolean {
  return (
    sample.timeSeconds.value !== undefined &&
    sample.eyeAngles.value !== undefined &&
    sample.playerPosition.value !== undefined &&
    sample.targetPosition.value !== undefined
  );
}

export function sha256Canonical(value: unknown): string {
  const hash = createHash("sha256");
  const sink = { buffer: "" };
  writeCanonical(hash, value, sink);
  if (sink.buffer) hash.update(sink.buffer);
  return hash.digest("hex");
}

function writeCanonical(
  hash: Hash,
  value: unknown,
  sink: { buffer: string },
): void {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    emitCanonical(hash, sink, JSON.stringify(value));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(
        "canonical artifacts cannot contain non-finite numbers",
      );
    emitCanonical(hash, sink, JSON.stringify(Object.is(value, -0) ? 0 : value));
    return;
  }
  if (Array.isArray(value)) {
    emitCanonical(hash, sink, "[");
    if (value.length > 1_000) {
      value.forEach((item, index) => {
        if (index) emitCanonical(hash, sink, ",");
        emitCanonical(hash, sink, canonicalJson(item));
      });
      emitCanonical(hash, sink, "]");
      return;
    }
    value.forEach((item, index) => {
      if (index) emitCanonical(hash, sink, ",");
      writeCanonical(hash, item, sink);
    });
    emitCanonical(hash, sink, "]");
    return;
  }
  if (typeof value === "object") {
    emitCanonical(hash, sink, "{");
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    entries.forEach(([key, item], index) => {
      if (index) emitCanonical(hash, sink, ",");
      emitCanonical(hash, sink, JSON.stringify(key));
      emitCanonical(hash, sink, ":");
      writeCanonical(hash, item, sink);
    });
    emitCanonical(hash, sink, "}");
    return;
  }
  throw new TypeError(`unsupported canonical artifact value: ${typeof value}`);
}

function emitCanonical(hash: Hash, sink: { buffer: string }, fragment: string) {
  sink.buffer += fragment;
  if (sink.buffer.length >= 1024 * 1024) {
    hash.update(sink.buffer);
    sink.buffer = "";
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(
        "canonical artifacts cannot contain non-finite numbers",
      );
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  throw new TypeError(`unsupported canonical artifact value: ${typeof value}`);
}

function assertSha256(value: string, name: string): void {
  if (!/^[a-f\d]{64}$/i.test(value))
    throw new RangeError(`${name} must be a 64-character hexadecimal digest`);
}
