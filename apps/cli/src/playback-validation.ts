import { createHash } from "node:crypto";
import type {
  AvailableValue,
  ProjectedPlayerObservation,
  Vector3,
  ViewAngles,
} from "@l4dstats/contracts";
import type { PreparedDemoProjection } from "./evidence-bundle.js";

export interface PlaybackExportRequest {
  readonly schemaVersion: 1;
  readonly ticks: readonly number[];
  readonly l4dstatsRevision: string;
  readonly tickIntervalSeconds?: number;
}

export interface PlaybackPlayerCheckpoint {
  readonly playerEpochId: string;
  readonly entitySlot: number;
  readonly lifetime: number;
  readonly team: AvailableValue<number>;
  readonly playerClass: AvailableValue<string>;
  readonly position: AvailableValue<Vector3>;
  readonly eyeAngles: AvailableValue<ViewAngles>;
  readonly weapon: AvailableValue<string>;
}

export interface PlaybackCheckpoint {
  readonly tick: number;
  readonly players: readonly PlaybackPlayerCheckpoint[];
}

export interface PlaybackCheckpointExport {
  readonly schemaVersion: 1;
  readonly producer: "l4dstats";
  readonly demoSha256: string;
  readonly mapName: string;
  readonly l4dstatsRevision: string;
  readonly selectedTicks: readonly number[];
  readonly checkpoints: readonly PlaybackCheckpoint[];
}

export interface PlaybackReference
  extends Omit<PlaybackCheckpointExport, "producer"> {
  readonly producer: "licensed-playback-reference";
  readonly gameBuildId: string;
  readonly mapAssetId: string;
  readonly instrumentationVersion: string;
  readonly tolerances: {
    readonly positionUnits: number;
    readonly eyeAngleDegrees: number;
  };
}

export interface PlaybackDifference {
  readonly tick: number;
  readonly playerEpochId: string;
  readonly field: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly tolerance?: number;
}

export interface PlaybackComparisonReport {
  readonly schemaVersion: 1;
  readonly passed: boolean;
  readonly demoSha256: string;
  readonly l4dstatsExportSha256: string;
  readonly referenceSha256: string;
  readonly tolerances: PlaybackReference["tolerances"];
  readonly gameBuildId: string;
  readonly mapAssetId: string;
  readonly instrumentationVersion: string;
  readonly l4dstatsRevision: string;
  readonly differences: readonly PlaybackDifference[];
}

export function parsePlaybackExportRequest(
  value: unknown,
): PlaybackExportRequest {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.ticks)
  )
    throw new TypeError(
      "playback export request must use schemaVersion 1 and contain ticks",
    );
  const ticks = [...new Set(value.ticks)].sort((a, b) => Number(a) - Number(b));
  if (
    ticks.length === 0 ||
    ticks.some((tick) => !Number.isSafeInteger(tick) || Number(tick) < 0)
  )
    throw new TypeError("ticks must contain unique non-negative safe integers");
  if (
    typeof value.l4dstatsRevision !== "string" ||
    value.l4dstatsRevision.trim() === ""
  )
    throw new TypeError("l4dstatsRevision is required");
  if (
    value.tickIntervalSeconds !== undefined &&
    (typeof value.tickIntervalSeconds !== "number" ||
      !Number.isFinite(value.tickIntervalSeconds) ||
      value.tickIntervalSeconds <= 0)
  )
    throw new TypeError("tickIntervalSeconds must be positive when supplied");
  return {
    schemaVersion: 1,
    ticks: ticks as number[],
    l4dstatsRevision: value.l4dstatsRevision,
    ...(value.tickIntervalSeconds === undefined
      ? {}
      : { tickIntervalSeconds: value.tickIntervalSeconds }),
  };
}

export function exportPlaybackCheckpoints(
  prepared: PreparedDemoProjection,
  request: PlaybackExportRequest,
): PlaybackCheckpointExport {
  const selected = new Set(request.ticks);
  const byTick = new Map<number, ProjectedPlayerObservation[]>();
  for (const observation of prepared.observations) {
    if (!selected.has(observation.observation.tick)) continue;
    const values = byTick.get(observation.observation.tick) ?? [];
    values.push(observation);
    byTick.set(observation.observation.tick, values);
  }
  const epochs = new Map(
    prepared.playerEpochs.map((epoch) => [epoch.id, epoch]),
  );
  return {
    schemaVersion: 1,
    producer: "l4dstats",
    demoSha256: prepared.demoSha256,
    mapName: prepared.header.mapName,
    l4dstatsRevision: request.l4dstatsRevision,
    selectedTicks: request.ticks,
    checkpoints: request.ticks.map((tick) => ({
      tick,
      players: (byTick.get(tick) ?? [])
        .map(({ observation }) => {
          const epoch = epochs.get(observation.playerEpochId);
          if (!epoch)
            throw new Error(`missing epoch ${observation.playerEpochId}`);
          const lifetime = Number(
            observation.playerEpochId.slice(
              observation.playerEpochId.lastIndexOf(":") + 1,
            ),
          );
          if (!Number.isSafeInteger(lifetime))
            throw new Error("invalid internal lifetime identifier");
          return {
            playerEpochId: observation.playerEpochId,
            entitySlot: epoch.entitySlot,
            lifetime,
            team: observation.team,
            playerClass: observation.playerClass,
            position: observation.position,
            eyeAngles: observation.eyeAngles,
            weapon: observation.weapon,
          };
        })
        .sort((a, b) => a.entitySlot - b.entitySlot || a.lifetime - b.lifetime),
    })),
  };
}

export function comparePlaybackCheckpoints(
  observed: PlaybackCheckpointExport,
  reference: PlaybackReference,
  observedBytes: Uint8Array,
  referenceBytes: Uint8Array,
): PlaybackComparisonReport {
  validateComparisonInputs(observed, reference);
  const differences: PlaybackDifference[] = [];
  const actualTicks = new Map(
    observed.checkpoints.map((value) => [value.tick, value]),
  );
  for (const expectedTick of reference.checkpoints) {
    const actualTick = actualTicks.get(expectedTick.tick);
    if (!actualTick) {
      differences.push(
        diff(expectedTick.tick, "-", "checkpoint", "present", "missing"),
      );
      continue;
    }
    const actualPlayers = new Map(
      actualTick.players.map((player) => [player.playerEpochId, player]),
    );
    for (const expected of expectedTick.players) {
      const actual = actualPlayers.get(expected.playerEpochId);
      if (!actual) {
        differences.push(
          diff(
            expectedTick.tick,
            expected.playerEpochId,
            "player",
            "present",
            "missing",
          ),
        );
        continue;
      }
      compareExact(
        differences,
        expectedTick.tick,
        expected.playerEpochId,
        "entitySlot",
        expected.entitySlot,
        actual.entitySlot,
      );
      compareExact(
        differences,
        expectedTick.tick,
        expected.playerEpochId,
        "lifetime",
        expected.lifetime,
        actual.lifetime,
      );
      compareAvailable(
        differences,
        expectedTick.tick,
        expected.playerEpochId,
        "team",
        expected.team,
        actual.team,
        0,
      );
      compareAvailable(
        differences,
        expectedTick.tick,
        expected.playerEpochId,
        "playerClass",
        expected.playerClass,
        actual.playerClass,
        0,
      );
      compareAvailable(
        differences,
        expectedTick.tick,
        expected.playerEpochId,
        "weapon",
        expected.weapon,
        actual.weapon,
        0,
      );
      compareAvailable(
        differences,
        expectedTick.tick,
        expected.playerEpochId,
        "position",
        expected.position,
        actual.position,
        reference.tolerances.positionUnits,
      );
      compareAvailable(
        differences,
        expectedTick.tick,
        expected.playerEpochId,
        "eyeAngles",
        expected.eyeAngles,
        actual.eyeAngles,
        reference.tolerances.eyeAngleDegrees,
      );
      actualPlayers.delete(expected.playerEpochId);
    }
    for (const extra of actualPlayers.values())
      differences.push(
        diff(
          expectedTick.tick,
          extra.playerEpochId,
          "player",
          "missing",
          "present",
        ),
      );
    actualTicks.delete(expectedTick.tick);
  }
  for (const extra of actualTicks.values())
    differences.push(diff(extra.tick, "-", "checkpoint", "missing", "present"));
  return {
    schemaVersion: 1,
    passed: differences.length === 0,
    demoSha256: observed.demoSha256,
    l4dstatsExportSha256: sha256(observedBytes),
    referenceSha256: sha256(referenceBytes),
    tolerances: reference.tolerances,
    gameBuildId: reference.gameBuildId,
    mapAssetId: reference.mapAssetId,
    instrumentationVersion: reference.instrumentationVersion,
    l4dstatsRevision: observed.l4dstatsRevision,
    differences,
  };
}

function validateComparisonInputs(
  observed: PlaybackCheckpointExport,
  reference: PlaybackReference,
): void {
  if (observed.schemaVersion !== 1 || reference.schemaVersion !== 1)
    throw new TypeError("comparison inputs must use schemaVersion 1");
  if (
    observed.producer !== "l4dstats" ||
    reference.producer !== "licensed-playback-reference"
  )
    throw new TypeError(
      "comparison requires L4DStats and licensed-playback-reference producers",
    );
  if (observed.demoSha256 !== reference.demoSha256)
    throw new TypeError("demo hashes do not match");
  if (observed.mapName !== reference.mapName)
    throw new TypeError("map names do not match");
  if (observed.l4dstatsRevision !== reference.l4dstatsRevision)
    throw new TypeError("L4DStats revisions do not match");
  if (!/^[a-f\d]{64}$/i.test(observed.demoSha256))
    throw new TypeError("demo SHA-256 is invalid");
  for (const [name, value] of [
    ["mapName", observed.mapName],
    ["l4dstatsRevision", observed.l4dstatsRevision],
    ["gameBuildId", reference.gameBuildId],
    ["mapAssetId", reference.mapAssetId],
    ["instrumentationVersion", reference.instrumentationVersion],
  ] as const)
    if (typeof value !== "string" || value.trim() === "")
      throw new TypeError(`${name} must be non-empty`);
  validateTickStructure(observed, "L4DStats export");
  validateTickStructure(reference, "playback reference");
  if (
    observed.selectedTicks.length !== reference.selectedTicks.length ||
    observed.selectedTicks.some(
      (tick, index) => tick !== reference.selectedTicks[index],
    )
  )
    throw new TypeError("selected ticks do not match");
  for (const tolerance of Object.values(reference.tolerances))
    if (!Number.isFinite(tolerance) || tolerance < 0)
      throw new TypeError("tolerances must be finite and non-negative");
}

function validateTickStructure(
  value: PlaybackCheckpointExport | PlaybackReference,
  name: string,
): void {
  if (!Array.isArray(value.selectedTicks) || !Array.isArray(value.checkpoints))
    throw new TypeError(`${name} must contain selected ticks and checkpoints`);
  if (
    value.selectedTicks.length === 0 ||
    value.selectedTicks.some(
      (tick, index) =>
        !Number.isSafeInteger(tick) ||
        tick < 0 ||
        (index > 0 && tick <= value.selectedTicks[index - 1]!),
    )
  )
    throw new TypeError(`${name} selected ticks must be unique and sorted`);
  const checkpointTicks = value.checkpoints.map(({ tick }) => tick);
  if (
    checkpointTicks.length !== value.selectedTicks.length ||
    checkpointTicks.some((tick, index) => tick !== value.selectedTicks[index])
  )
    throw new TypeError(
      `${name} checkpoints must match selected ticks exactly`,
    );
  for (const checkpoint of value.checkpoints) {
    const ids = new Set<string>();
    for (const player of checkpoint.players) {
      if (ids.has(player.playerEpochId))
        throw new TypeError(`${name} contains a duplicate player epoch`);
      ids.add(player.playerEpochId);
      if (
        player.playerEpochId.trim() === "" ||
        !Number.isSafeInteger(player.entitySlot) ||
        player.entitySlot < 0 ||
        !Number.isSafeInteger(player.lifetime) ||
        player.lifetime < 0
      )
        throw new TypeError(`${name} contains invalid player identity fields`);
      validateAvailableValue(
        player.team,
        `${name}.team`,
        (item) => typeof item === "number" && Number.isFinite(item),
      );
      validateAvailableValue(
        player.playerClass,
        `${name}.playerClass`,
        (item) => typeof item === "string",
      );
      validateAvailableValue(player.position, `${name}.position`, (item) =>
        isFiniteRecord(item, ["x", "y", "z"]),
      );
      validateAvailableValue(player.eyeAngles, `${name}.eyeAngles`, (item) =>
        isFiniteRecord(item, ["pitch", "roll", "yaw"]),
      );
      validateAvailableValue(
        player.weapon,
        `${name}.weapon`,
        (item) => typeof item === "string",
      );
    }
  }
}

function validateAvailableValue(
  value: AvailableValue<unknown>,
  name: string,
  validValue: (value: unknown) => boolean,
): void {
  if (
    !isObject(value) ||
    !["observed", "derived", "unavailable"].includes(
      value.availability as string,
    )
  )
    throw new TypeError(`${name} has invalid availability`);
  if (
    value.availability === "unavailable" &&
    (typeof value.reason !== "string" || value.reason.trim() === "")
  )
    throw new TypeError(`${name} unavailable values require a reason`);
  if (value.availability !== "unavailable" && !validValue(value.value))
    throw new TypeError(`${name} has an invalid available value`);
}

function isFiniteRecord(value: unknown, expectedKeys: readonly string[]) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    keys.every(
      (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
    )
  );
}

function compareAvailable(
  differences: PlaybackDifference[],
  tick: number,
  id: string,
  field: string,
  expected: AvailableValue<unknown>,
  actual: AvailableValue<unknown>,
  tolerance: number,
): void {
  if (expected.availability !== actual.availability) {
    differences.push(
      diff(
        tick,
        id,
        `${field}.availability`,
        expected.availability,
        actual.availability,
      ),
    );
    return;
  }
  if (
    expected.availability === "unavailable" ||
    actual.availability === "unavailable"
  )
    return;
  if (!withinTolerance(expected.value, actual.value, tolerance))
    differences.push({
      ...diff(tick, id, field, expected.value, actual.value),
      ...(tolerance === 0 ? {} : { tolerance }),
    });
}

function withinTolerance(
  expected: unknown,
  actual: unknown,
  tolerance: number,
): boolean {
  if (typeof expected === "number" && typeof actual === "number")
    return Math.abs(expected - actual) <= tolerance;
  if (
    Array.isArray(expected) &&
    Array.isArray(actual) &&
    expected.length === actual.length
  )
    return expected.every((value, index) =>
      withinTolerance(value, actual[index], tolerance),
    );
  if (isObject(expected) && isObject(actual)) {
    const keys = Object.keys(expected);
    return (
      keys.length === Object.keys(actual).length &&
      keys.every((key) =>
        withinTolerance(expected[key], actual[key], tolerance),
      )
    );
  }
  return Object.is(expected, actual);
}

function compareExact(
  differences: PlaybackDifference[],
  tick: number,
  id: string,
  field: string,
  expected: unknown,
  actual: unknown,
): void {
  if (!Object.is(expected, actual))
    differences.push(diff(tick, id, field, expected, actual));
}

function diff(
  tick: number,
  playerEpochId: string,
  field: string,
  expected: unknown,
  actual: unknown,
): PlaybackDifference {
  return { tick, playerEpochId, field, expected, actual };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
