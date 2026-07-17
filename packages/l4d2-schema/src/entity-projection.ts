import type {
  AvailableValue,
  PlayerEpoch,
  PlayerObservation,
  Vector3,
  ViewAngles,
} from "@witchwatch/contracts";
import {
  visitL4d2EntityFrames,
  type EntityFrameVisit,
  type EntitySnapshot,
  type SendPropValue,
} from "@witchwatch/demo-source1";

export interface ProjectableUserInfo {
  /** Explicit mapping; callers must not assume userinfo slot equals entity index. */
  readonly entityIndex: number;
  readonly userInfoSlot: number;
  readonly userId?: number;
  /** A caller-produced privacy-safe stable token. Raw Steam IDs are not accepted. */
  readonly stableIdentityToken?: string;
  /** First demo tick at which this mapping is authoritative. */
  readonly effectiveTick?: number;
}

export interface PlayerProjectionOptions {
  readonly demoSha256: string;
  readonly tickIntervalSeconds?: number;
  readonly userInfo: readonly ProjectableUserInfo[];
  /** Streaming sink. Observations are not retained by the projector. */
  readonly onObservation?: (observation: ProjectedPlayerObservation) => void;
}

export interface ProjectionFieldProvenance {
  readonly source:
    | "network-send-property"
    | "derived-engine-tick"
    | "derived-network-normalization"
    | "unavailable";
  readonly properties: readonly string[];
  readonly reason?: string;
}

export interface ProjectedPlayerObservation {
  readonly observation: PlayerObservation;
  readonly provenance: Readonly<
    Record<
      | "demoTimeSeconds"
      | "position"
      | "eyeAngles"
      | "team"
      | "playerClass"
      | "weapon"
      | "buttons",
      ProjectionFieldProvenance
    >
  >;
}

export interface PlayerProjectionCoverage {
  readonly framesVisited: number;
  readonly observationsEmitted: number;
  readonly fieldAvailability: Readonly<
    Record<
      | "demoTimeSeconds"
      | "position"
      | "eyeAngles"
      | "team"
      | "playerClass"
      | "weapon"
      | "buttons",
      {
        readonly observed: number;
        readonly derived: number;
        readonly unavailable: number;
      }
    >
  >;
}

export interface PlayerProjectionResult {
  readonly playerEpochs: readonly PlayerEpoch[];
  readonly coverage: PlayerProjectionCoverage;
}

interface ActiveEpoch {
  readonly entityIndex: number;
  readonly lifetime: number;
  readonly epoch: PlayerEpoch;
}

const fieldNames = [
  "demoTimeSeconds",
  "position",
  "eyeAngles",
  "team",
  "playerClass",
  "weapon",
  "buttons",
] as const;
type ProjectionField = (typeof fieldNames)[number];

const missing = <T>(reason: string): AvailableValue<T> => ({
  availability: "unavailable",
  reason,
});
const observed = <T>(value: T): AvailableValue<T> => ({
  availability: "observed",
  value,
});
const derived = <T>(value: T): AvailableValue<T> => ({
  availability: "derived",
  value,
});

/**
 * Projects only networked CTerrorPlayer state. SourceTV command-info and absent
 * user commands are deliberately excluded; in particular, buttons never
 * acquire a manufactured value.
 */
export class L4d2PlayerProjector {
  readonly #options: PlayerProjectionOptions;
  readonly #userInfo: ReadonlyMap<number, readonly ProjectableUserInfo[]>;
  readonly #active = new Map<number, ActiveEpoch>();
  readonly #completed: PlayerEpoch[] = [];
  readonly #counts = Object.fromEntries(
    fieldNames.map((field) => [
      field,
      { observed: 0, derived: 0, unavailable: 0 },
    ]),
  ) as Record<
    ProjectionField,
    { observed: number; derived: number; unavailable: number }
  >;
  #framesVisited = 0;
  #observationsEmitted = 0;

  constructor(options: PlayerProjectionOptions) {
    if (!/^[a-f\d]{64}$/i.test(options.demoSha256))
      throw new RangeError(
        "demoSha256 must be a 64-character hexadecimal digest",
      );
    if (
      options.tickIntervalSeconds !== undefined &&
      (!Number.isFinite(options.tickIntervalSeconds) ||
        options.tickIntervalSeconds <= 0)
    )
      throw new RangeError("tickIntervalSeconds must be positive");
    const entries = new Map<number, ProjectableUserInfo[]>();
    for (const identity of options.userInfo) {
      const list = entries.get(identity.entityIndex) ?? [];
      if (
        list.some(
          ({ effectiveTick }) =>
            (effectiveTick ?? Number.NEGATIVE_INFINITY) ===
            (identity.effectiveTick ?? Number.NEGATIVE_INFINITY),
        )
      )
        throw new RangeError(
          `duplicate userinfo mapping for entity ${identity.entityIndex} at the same effective tick`,
        );
      list.push(identity);
      list.sort(
        (a, b) =>
          (a.effectiveTick ?? Number.NEGATIVE_INFINITY) -
          (b.effectiveTick ?? Number.NEGATIVE_INFINITY),
      );
      entries.set(identity.entityIndex, list);
    }
    this.#options = options;
    this.#userInfo = entries;
  }

  visit(value: EntityFrameVisit): void {
    this.#framesVisited += 1;
    const activePlayers = new Set<number>();
    for (const entity of value.frame.entities.values()) {
      if (
        !entity.active ||
        value.classes[entity.classId]?.className !== "CTerrorPlayer"
      )
        continue;
      activePlayers.add(entity.entityIndex);
      const epoch = this.#epochFor(entity, value.demoTick);
      const projected = projectObservation(
        this.#options.demoSha256,
        epoch.epoch.id,
        value,
        entity,
        this.#options.tickIntervalSeconds,
      );
      this.#record(projected);
      this.#options.onObservation?.(projected);
    }
    for (const [entityIndex, active] of this.#active) {
      if (!activePlayers.has(entityIndex)) this.#close(active, value.demoTick);
    }
  }

  finish(): PlayerProjectionResult {
    return {
      playerEpochs: [
        ...this.#completed,
        ...[...this.#active.values()].map(({ epoch }) => epoch),
      ].sort(
        (a, b) =>
          a.connectedAtTick - b.connectedAtTick || a.entitySlot - b.entitySlot,
      ),
      coverage: {
        framesVisited: this.#framesVisited,
        observationsEmitted: this.#observationsEmitted,
        fieldAvailability: this.#counts,
      },
    };
  }

  #epochFor(entity: EntitySnapshot, tick: number): ActiveEpoch {
    const current = this.#active.get(entity.entityIndex);
    if (current?.lifetime === entity.lifetime) return current;
    if (current) this.#close(current, tick);
    const identities = this.#userInfo.get(entity.entityIndex);
    let identity: ProjectableUserInfo | undefined;
    for (const candidate of identities ?? [])
      if ((candidate.effectiveTick ?? Number.NEGATIVE_INFINITY) <= tick)
        identity = candidate;
    const epoch: PlayerEpoch = {
      id: `${this.#options.demoSha256}:${entity.entityIndex}:${entity.lifetime}`,
      demoSha256: this.#options.demoSha256,
      entitySlot: entity.entityIndex,
      userId:
        identity?.userId === undefined
          ? missing("userinfo user ID was not mapped")
          : observed(identity.userId),
      steamId:
        identity?.stableIdentityToken === undefined
          ? missing("privacy-safe stable identity token was not supplied")
          : observed(identity.stableIdentityToken),
      connectedAtTick: tick,
      disconnectedAtTick: missing(
        "entity lifetime remained active at end of decoded range",
      ),
    };
    const active = {
      entityIndex: entity.entityIndex,
      lifetime: entity.lifetime,
      epoch,
    };
    this.#active.set(entity.entityIndex, active);
    return active;
  }

  #close(active: ActiveEpoch, tick: number): void {
    if (this.#active.get(active.entityIndex) !== active) return;
    this.#active.delete(active.entityIndex);
    this.#completed.push({
      ...active.epoch,
      disconnectedAtTick: observed(tick),
    });
  }

  #record(projected: ProjectedPlayerObservation): void {
    this.#observationsEmitted += 1;
    for (const field of fieldNames)
      this.#counts[field][projected.observation[field].availability] += 1;
  }
}

/** Convenience streaming entry point over the protocol-2100 entity visitor. */
export function projectL4d2PlayerObservations(
  bytes: Uint8Array,
  options: PlayerProjectionOptions,
): PlayerProjectionResult {
  const projector = new L4d2PlayerProjector(options);
  visitL4d2EntityFrames(bytes, (frame) => projector.visit(frame));
  return projector.finish();
}

function projectObservation(
  demoSha256: string,
  playerEpochId: string,
  value: EntityFrameVisit,
  player: EntitySnapshot,
  tickIntervalSeconds: number | undefined,
): ProjectedPlayerObservation {
  const position = readPosition(player.properties);
  const eyeAngles = readAngles(player.properties);
  const team = readScalar(player.properties, ["m_iTeamNum"]);
  const zombieClass = readScalar(player.properties, ["m_zombieClass"]);
  const weaponHandle = readScalar(player.properties, ["m_hActiveWeapon"]);
  const weapon = resolveWeapon(weaponHandle, value);
  const demoTime =
    tickIntervalSeconds === undefined
      ? absent<number>("tick interval was not supplied")
      : present(
          value.engineTick * tickIntervalSeconds,
          [],
          "derived-engine-tick",
        );
  const playerClass =
    zombieClass.value === undefined
      ? absent<string>("networked zombie class was unavailable")
      : present(`zombie-class:${zombieClass.value}`, zombieClass.paths);
  const buttons = absent<number>(
    "SourceTV does not contain per-player user-command buttons",
  );

  return {
    observation: {
      schemaVersion: 1,
      demoSha256,
      playerEpochId,
      tick: value.demoTick,
      demoTimeSeconds: demoTime.available,
      position: position.available,
      eyeAngles: eyeAngles.available,
      team:
        team.value === undefined
          ? missing("networked team was unavailable")
          : observed(team.value),
      playerClass: playerClass.available,
      weapon: weapon.available,
      buttons: buttons.available,
    },
    provenance: {
      demoTimeSeconds: demoTime.provenance,
      position: position.provenance,
      eyeAngles: eyeAngles.provenance,
      team:
        team.value === undefined
          ? unavailableProvenance("networked team was unavailable")
          : networkProvenance(team.paths),
      playerClass: playerClass.provenance,
      weapon: weapon.provenance,
      buttons: buttons.provenance,
    },
  };
}

function readPosition(properties: ReadonlyMap<string, SendPropValue>) {
  const vector = readVector(properties, ["m_vecOrigin"]);
  if (vector) return present(vector.value, vector.paths);
  const xy = readNumberArray(properties, ["m_vecOrigin"], 2);
  const localZ = readScalar(properties, ["m_vecOrigin[2]", "m_vecOrigin.z"]);
  if (xy && localZ.value !== undefined)
    return present({ x: xy.value[0]!, y: xy.value[1]!, z: localZ.value }, [
      ...xy.paths,
      ...localZ.paths,
    ]);
  const x = readScalar(properties, ["m_vecOrigin[0]", "m_vecOrigin.x"]);
  const y = readScalar(properties, ["m_vecOrigin[1]", "m_vecOrigin.y"]);
  const z = readScalar(properties, ["m_vecOrigin[2]", "m_vecOrigin.z"]);
  if (x.value === undefined || y.value === undefined || z.value === undefined)
    return absent<Vector3>("complete networked origin XYZ was unavailable");
  return present({ x: x.value, y: y.value, z: z.value }, [
    ...x.paths,
    ...y.paths,
    ...z.paths,
  ]);
}

function readAngles(properties: ReadonlyMap<string, SendPropValue>) {
  const vector = readVector(properties, ["m_angEyeAngles"]);
  if (vector)
    return present(
      { pitch: vector.value.x, yaw: vector.value.y, roll: vector.value.z },
      vector.paths,
    );
  const pitch = readScalar(properties, [
    "m_angEyeAngles[0]",
    "m_angEyeAngles.0",
  ]);
  const yaw = readScalar(properties, ["m_angEyeAngles[1]", "m_angEyeAngles.1"]);
  const roll = readScalar(properties, [
    "m_angEyeAngles[2]",
    "m_angEyeAngles.2",
  ]);
  if (pitch.value === undefined || yaw.value === undefined)
    return absent<ViewAngles>("networked eye pitch and yaw were unavailable");
  if (roll.value === undefined)
    return present(
      { pitch: pitch.value, yaw: yaw.value, roll: 0 },
      [...pitch.paths, ...yaw.paths],
      "derived-network-normalization",
      "L4D2 networks player eye pitch/yaw only; canonical roll is explicitly normalized to zero",
    );
  return present({ pitch: pitch.value, yaw: yaw.value, roll: roll.value }, [
    ...pitch.paths,
    ...yaw.paths,
    ...roll.paths,
  ]);
}

function resolveWeapon(
  handle: ReturnType<typeof readScalar>,
  value: EntityFrameVisit,
) {
  if (handle.value === undefined)
    return absent<string>("active weapon handle was unavailable");
  const index = handle.value & 0x7ff;
  const entity = value.frame.entities.get(index);
  const className = entity && value.classes[entity.classId]?.className;
  if (!entity?.active || !className)
    return absent<string>(
      "active weapon handle did not resolve to an active network entity",
    );
  return present(className, handle.paths);
}

function readScalar(
  properties: ReadonlyMap<string, SendPropValue>,
  suffixes: readonly string[],
) {
  for (const [path, value] of properties)
    if (
      suffixes.some(
        (suffix) => path === suffix || path.endsWith(`.${suffix}`),
      ) &&
      typeof value === "number"
    )
      return { value, paths: [path] as readonly string[] };
  return { value: undefined, paths: [] as readonly string[] };
}

function readVector(
  properties: ReadonlyMap<string, SendPropValue>,
  suffixes: readonly string[],
) {
  for (const [path, value] of properties) {
    if (
      !suffixes.some(
        (suffix) => path === suffix || path.endsWith(`.${suffix}`),
      ) ||
      !Array.isArray(value)
    )
      continue;
    const [x, y, z] = value;
    if (typeof x === "number" && typeof y === "number" && typeof z === "number")
      return { value: { x, y, z }, paths: [path] as readonly string[] };
  }
  return undefined;
}

function readNumberArray(
  properties: ReadonlyMap<string, SendPropValue>,
  suffixes: readonly string[],
  minimumLength: number,
) {
  for (const [path, value] of properties) {
    if (
      suffixes.some(
        (suffix) => path === suffix || path.endsWith(`.${suffix}`),
      ) &&
      Array.isArray(value) &&
      value.length >= minimumLength &&
      value.slice(0, minimumLength).every((item) => typeof item === "number")
    )
      return {
        value: value as readonly number[],
        paths: [path] as readonly string[],
      };
  }
  return undefined;
}

function present<T>(
  value: T,
  properties: readonly string[],
  source: ProjectionFieldProvenance["source"] = "network-send-property",
  reason?: string,
) {
  return {
    available:
      source === "network-send-property" ? observed(value) : derived(value),
    provenance: {
      source,
      properties,
      ...(reason === undefined ? {} : { reason }),
    } satisfies ProjectionFieldProvenance,
  };
}

function absent<T>(reason: string) {
  return {
    available: missing<T>(reason),
    provenance: unavailableProvenance(reason),
  };
}

function networkProvenance(
  properties: readonly string[],
): ProjectionFieldProvenance {
  return { source: "network-send-property", properties };
}

function unavailableProvenance(reason: string): ProjectionFieldProvenance {
  return { source: "unavailable", properties: [], reason };
}
