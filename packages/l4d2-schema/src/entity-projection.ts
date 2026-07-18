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
  /** Streaming sink for bounded Witch entity state. */
  readonly onWitchObservation?: (observation: L4d2WitchObservation) => void;
}

export interface L4d2WitchObservation {
  readonly entityIndex: number;
  readonly lifetime: number;
  readonly tick: number;
  readonly timeSeconds?: number | undefined;
  /**
   * Cell-relative origin from DT_Witch. This is not a world coordinate and
   * must never be overlaid on BSP geometry without validated cell state.
   */
  readonly cellRelativeOrigin?: Vector3 | undefined;
  readonly rage?: number | undefined;
  readonly wanderRage?: number | undefined;
  readonly burning?: boolean | undefined;
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
  /** L4D2-specific network state retained for match-stat derivation. */
  readonly l4d2: L4d2PlayerState;
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

export interface L4d2PlayerState {
  readonly entityIndex: number;
  readonly health?: number | undefined;
  readonly maxHealth?: number | undefined;
  readonly healthBuffer?: number | undefined;
  readonly lifeState?: number | undefined;
  readonly incapacitated?: boolean | undefined;
  readonly ghost?: boolean | undefined;
  readonly versusTeam?: number | undefined;
  readonly checkpointZombieKills?: readonly number[] | undefined;
  readonly checkpointRevives?: number | undefined;
  readonly checkpointIncaps?: number | undefined;
  readonly checkpointSpecialIncaps?: number | undefined;
  readonly checkpointPounces?: number | undefined;
  readonly highestPounceDamage?: number | undefined;
  readonly longestJockeyRide?: number | undefined;
  readonly frustration?: number | undefined;
  readonly tongueVictim?: number | undefined;
  readonly pounceVictim?: number | undefined;
  readonly jockeyVictim?: number | undefined;
  readonly carryVictim?: number | undefined;
  readonly pummelVictim?: number | undefined;
  readonly loadout?: L4d2PlayerLoadout | undefined;
  readonly activeWeaponAmmo?: L4d2ActiveWeaponAmmo | undefined;
  readonly counters?:
    | Readonly<Partial<Record<L4d2CounterName, number>>>
    | undefined;
}

export interface L4d2ActiveWeaponAmmo {
  readonly weaponClass?: string | undefined;
  readonly primaryAmmoType?: number | undefined;
  readonly clip?: number | undefined;
  readonly reserve?: number | undefined;
  readonly reloading?: boolean | undefined;
  readonly extraPrimaryAmmo?: number | undefined;
  readonly upgradedAmmoLoaded?: number | undefined;
}

export interface L4d2PlayerLoadout {
  /** Observed CTerrorPlayerResource weapon ID. Zero means the slot is empty. */
  readonly primaryWeaponId?: number | undefined;
  readonly firstAidSlotId?: number | undefined;
  readonly pillsSlotId?: number | undefined;
}

export interface L4d2WeaponIdentity {
  readonly id: number;
  readonly name: string;
  readonly category:
    | "primary"
    | "secondary"
    | "medical"
    | "temporary-health"
    | "utility"
    | "infected"
    | "world"
    | "unknown";
}

export const l4d2CounterNames = [
  "m_checkpointSurvivorDamage",
  "m_checkpointMedkitsUsed",
  "m_checkpointPillsUsed",
  "m_checkpointMolotovsUsed",
  "m_checkpointPipebombsUsed",
  "m_checkpointBoomerBilesUsed",
  "m_checkpointAdrenalinesUsed",
  "m_checkpointDefibrillatorsUsed",
  "m_checkpointDamageTaken",
  "m_checkpointFirstAidShared",
  "m_checkpointDamageToTank",
  "m_checkpointDamageToWitch",
  "m_missionAccuracy",
  "m_checkpointHeadshots",
  "m_checkpointHeadshotAccuracy",
  "m_checkpointDeaths",
  "m_checkpointMeleeKills",
  "m_checkpointPZTankDamage",
  "m_checkpointPZHunterDamage",
  "m_checkpointPZSmokerDamage",
  "m_checkpointPZBoomerDamage",
  "m_checkpointPZJockeyDamage",
  "m_checkpointPZSpitterDamage",
  "m_checkpointPZChargerDamage",
  "m_checkpointPZKills",
  "m_checkpointPZPushes",
  "m_checkpointPZTankPunches",
  "m_checkpointPZTankThrows",
  "m_checkpointPZHung",
  "m_checkpointPZPulled",
  "m_checkpointPZBombed",
  "m_checkpointPZVomited",
  "m_checkpointPZLongestSmokerGrab",
  "m_checkpointPZNumChargeVictims",
] as const;
export type L4d2CounterName = (typeof l4d2CounterNames)[number];

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
  readonly matchStates: readonly L4d2MatchState[];
}

export interface L4d2MatchState {
  readonly tick: number;
  readonly campaignScores: readonly number[];
  readonly chapterScores: readonly number[];
  readonly survivorScores: readonly number[];
  readonly survivorDistances: readonly number[];
  readonly survivorDeathDistances: readonly number[];
  readonly roundDurations: readonly number[];
  readonly roundNumber?: number | undefined;
  readonly teamsFlipped?: boolean | undefined;
  readonly secondHalf?: boolean | undefined;
  readonly voteRestarting?: boolean | undefined;
  readonly roundSetupTimeRemaining?: number | undefined;
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
  #matchStates: L4d2MatchState[] = [];
  #matchStateSignature = "";

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
    this.#recordMatchState(value);
    const activePlayers = new Set<number>();
    const playerResource = [...value.frame.entities.values()].find(
      (entity) =>
        entity.active &&
        value.classes[entity.classId]?.className === "CTerrorPlayerResource",
    );
    for (const entity of value.frame.entities.values()) {
      if (!entity.active) continue;
      const className = value.classes[entity.classId]?.className;
      if (className === "Witch")
        this.#options.onWitchObservation?.(
          projectWitchObservation(
            value,
            entity,
            this.#options.tickIntervalSeconds,
          ),
        );
      if (className !== "CTerrorPlayer") continue;
      activePlayers.add(entity.entityIndex);
      const epoch = this.#epochFor(entity, value.demoTick);
      const projected = projectObservation(
        this.#options.demoSha256,
        epoch.epoch.id,
        value,
        entity,
        playerResource,
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
      matchStates: this.#matchStates,
    };
  }

  #recordMatchState(value: EntityFrameVisit): void {
    const rules = [...value.frame.entities.values()].find(
      (entity) =>
        entity.active &&
        value.classes[entity.classId]?.className === "CTerrorGameRulesProxy",
    );
    if (!rules) return;
    const playerResource = [...value.frame.entities.values()].find(
      (entity) =>
        entity.active &&
        value.classes[entity.classId]?.className === "CTerrorPlayerResource",
    );
    const teamsFlipped = readScalar(rules.properties, [
      "m_bAreTeamsFlipped",
    ]).value;
    const secondHalf = readScalar(rules.properties, [
      "m_bInSecondHalfOfRound",
    ]).value;
    const voteRestarting = readScalar(rules.properties, [
      "m_bIsVersusVoteRestarting",
    ]).value;
    const state: L4d2MatchState = {
      tick: value.demoTick,
      campaignScores: readIndexed(rules.properties, "m_iCampaignScore", 2),
      chapterScores: readIndexed(rules.properties, "m_iChapterScore", 2),
      survivorScores: readIndexed(rules.properties, "m_iSurvivorScore", 2),
      survivorDistances: readIndexed(
        rules.properties,
        "m_iVersusDistancePerSurvivor",
        8,
      ),
      survivorDeathDistances: readIndexed(
        rules.properties,
        "m_iVersusSurvivorDeathDistance",
        8,
      ),
      roundDurations: readIndexed(rules.properties, "m_flRoundDuration", 2),
      roundNumber: readScalar(rules.properties, ["m_nRoundNumber"]).value,
      ...(teamsFlipped === undefined
        ? {}
        : { teamsFlipped: teamsFlipped === 1 }),
      ...(secondHalf === undefined ? {} : { secondHalf: secondHalf === 1 }),
      ...(voteRestarting === undefined
        ? {}
        : { voteRestarting: voteRestarting === 1 }),
      ...(playerResource === undefined
        ? {}
        : (() => {
            const value = readScalar(playerResource.properties, [
              "m_nRoundSetupTimeRemaining",
            ]).value;
            return value === undefined
              ? {}
              : { roundSetupTimeRemaining: value };
          })()),
    };
    const signature = JSON.stringify({ ...state, tick: 0 });
    if (signature === this.#matchStateSignature) return;
    this.#matchStateSignature = signature;
    this.#matchStates.push(state);
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

function projectWitchObservation(
  value: EntityFrameVisit,
  entity: EntitySnapshot,
  tickIntervalSeconds: number | undefined,
): L4d2WitchObservation {
  const cellRelativeOrigin = readPosition(entity.properties).available.value;
  const rage = readScalar(entity.properties, ["m_rage"]).value;
  const wanderRage = readScalar(entity.properties, ["m_wanderrage"]).value;
  const burning = readScalar(entity.properties, ["m_bIsBurning"]).value;
  return {
    entityIndex: entity.entityIndex,
    lifetime: entity.lifetime,
    tick: value.demoTick,
    ...(tickIntervalSeconds === undefined
      ? {}
      : { timeSeconds: value.engineTick * tickIntervalSeconds }),
    ...(cellRelativeOrigin === undefined ? {} : { cellRelativeOrigin }),
    ...(rage === undefined ? {} : { rage }),
    ...(wanderRage === undefined ? {} : { wanderRage }),
    ...(burning === undefined ? {} : { burning: burning !== 0 }),
  };
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
  playerResource: EntitySnapshot | undefined,
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
      : present(l4d2ClassName(zombieClass.value), zombieClass.paths);
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
    l4d2: projectL4d2State(player, playerResource, value),
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

function l4d2ClassName(value: number): string {
  return (
    {
      1: "Smoker",
      2: "Boomer",
      3: "Hunter",
      4: "Spitter",
      5: "Jockey",
      6: "Charger",
      7: "Witch",
      8: "Tank",
      9: "Survivor",
    }[value] ?? `zombie-class:${value}`
  );
}

function projectL4d2State(
  player: EntitySnapshot,
  playerResource: EntitySnapshot | undefined,
  value: EntityFrameVisit,
): L4d2PlayerState {
  const scalar = (name: string) => readScalar(player.properties, [name]).value;
  const flag = (name: string) => {
    const value = scalar(name);
    return value === undefined ? undefined : value !== 0;
  };
  const handle = (name: string) => {
    const value = scalar(name);
    if (value === undefined || value === 0x1fffff) return undefined;
    return value & 0x7ff;
  };
  const zombieKills = readNumberArray(
    player.properties,
    ["m_checkpointZombieKills"],
    1,
  )?.value;
  const activeWeaponHandle = handle("m_hActiveWeapon");
  const activeWeapon =
    activeWeaponHandle === undefined
      ? undefined
      : value.frame.entities.get(activeWeaponHandle);
  const weaponScalar = (name: string) =>
    activeWeapon === undefined
      ? undefined
      : readScalar(activeWeapon.properties, [name]).value;
  const primaryAmmoType = weaponScalar("m_iPrimaryAmmoType");
  const reserve =
    primaryAmmoType === undefined || primaryAmmoType < 0
      ? undefined
      : scalar(`m_iAmmo.${String(primaryAmmoType).padStart(3, "0")}`);
  const reload = weaponScalar("m_bInReload");
  return {
    entityIndex: player.entityIndex,
    health: scalar("m_iHealth"),
    maxHealth: scalar("m_iMaxHealth"),
    healthBuffer: scalar("m_healthBuffer"),
    lifeState: scalar("m_lifeState"),
    incapacitated: flag("m_isIncapacitated"),
    ghost: flag("m_isGhost"),
    versusTeam: scalar("m_iVersusTeam"),
    checkpointZombieKills: zombieKills,
    checkpointRevives: scalar("m_checkpointReviveOtherCount"),
    checkpointIncaps: scalar("m_checkpointIncaps"),
    checkpointSpecialIncaps: scalar("m_checkpointPZIncaps"),
    checkpointPounces: scalar("m_checkpointPZPounces"),
    highestPounceDamage: scalar("m_checkpointPZHighestDmgPounce"),
    longestJockeyRide: scalar("m_checkpointPZLongestJockeyRide"),
    frustration: scalar("m_frustration"),
    tongueVictim: handle("m_tongueVictim"),
    pounceVictim: handle("m_pounceVictim"),
    jockeyVictim: handle("m_jockeyVictim"),
    carryVictim: handle("m_carryVictim"),
    pummelVictim: handle("m_pummelVictim"),
    ...(playerResource === undefined
      ? {}
      : {
          loadout: {
            primaryWeaponId: readScalar(playerResource.properties, [
              `m_primaryWeapon.${String(player.entityIndex).padStart(3, "0")}`,
            ]).value,
            firstAidSlotId: readScalar(playerResource.properties, [
              `m_firstAidSlot.${String(player.entityIndex).padStart(3, "0")}`,
            ]).value,
            pillsSlotId: readScalar(playerResource.properties, [
              `m_pillsSlot.${String(player.entityIndex).padStart(3, "0")}`,
            ]).value,
          },
        }),
    ...(activeWeapon === undefined
      ? {}
      : {
          activeWeaponAmmo: {
            weaponClass: value.classes[activeWeapon.classId]?.className,
            primaryAmmoType,
            clip: weaponScalar("m_iClip1"),
            reserve,
            ...(reload === undefined ? {} : { reloading: reload !== 0 }),
            extraPrimaryAmmo: weaponScalar("m_iExtraPrimaryAmmo"),
            upgradedAmmoLoaded: weaponScalar("m_nUpgradedPrimaryAmmoLoaded"),
          },
        }),
    counters: Object.fromEntries(
      l4d2CounterNames.flatMap((name) => {
        const value = scalar(name);
        return value === undefined ? [] : [[name, value]];
      }),
    ),
  };
}

const weaponNames = [
  "Empty",
  "Pistol",
  "SMG",
  "Pump Shotgun",
  "Auto Shotgun",
  "Assault Rifle",
  "Hunting Rifle",
  "Silenced SMG",
  "Chrome Shotgun",
  "Desert Rifle",
  "Military Sniper",
  "SPAS Shotgun",
  "First Aid Kit",
  "Molotov",
  "Pipe Bomb",
  "Pain Pills",
  "Gas Can",
  "Propane Tank",
  "Oxygen Tank",
  "Melee Weapon",
  "Chainsaw",
  "Grenade Launcher",
  "Ammo Pack",
  "Adrenaline",
  "Defibrillator",
  "Boomer Bile",
  "AK-47",
  "Gnome Chompski",
  "Cola Bottles",
  "Fireworks Box",
  "Incendiary Ammo",
  "Explosive Ammo",
  "Magnum",
  "MP5",
  "SG 552",
  "AWP",
  "Scout",
  "M60",
  "Tank Claw",
  "Hunter Claw",
  "Charger Claw",
  "Boomer Claw",
  "Smoker Claw",
  "Spitter Claw",
  "Jockey Claw",
  "Mounted Machine Gun",
  "Fatal Vomit",
  "Exploding Splat",
  "Lunge Pounce",
  "Lounge",
  "Full Pull",
  "Choke",
  "Tank Rock",
  "Hittable Physics",
  "Ammo",
  "Upgrade Item",
] as const;

export function l4d2WeaponIdentity(id: number): L4d2WeaponIdentity {
  const category: L4d2WeaponIdentity["category"] =
    id === 0
      ? "unknown"
      : id >= 38 && id <= 52
        ? "infected"
        : [1, 19, 20, 32].includes(id)
          ? "secondary"
          : [
                2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 21, 26, 33, 34, 35, 36, 37,
              ].includes(id)
            ? "primary"
            : [12, 24].includes(id)
              ? "medical"
              : [15, 23].includes(id)
                ? "temporary-health"
                : [13, 14, 22, 25, 30, 31, 55].includes(id)
                  ? "utility"
                  : "world";
  return {
    id,
    name: weaponNames[id] ?? `Unknown weapon ID ${id}`,
    category,
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

function readIndexed(
  properties: ReadonlyMap<string, SendPropValue>,
  prefix: string,
  count: number,
): readonly number[] {
  return Array.from(
    { length: count },
    (_, index) =>
      readScalar(properties, [`${prefix}.${String(index).padStart(3, "0")}`])
        .value ?? 0,
  );
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
