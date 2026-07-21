import type {
  AvailableValue,
  DecodeIssue,
  DemoHeader,
  DisplayUserInfoIdentity,
  GameEventTelemetrySummary,
  GameEventVisit,
  L4d2ActiveWeaponAmmo,
  L4d2MatchState,
  L4d2PlayerLoadout,
  L4d2PlayerState,
  L4d2ServerInfo,
  L4d2WitchObservation,
  PlayerEpoch,
  PlayerProjectionCoverage,
  ProjectableUserInfo,
  ProjectedPlayerObservation,
  RecorderCommandObservation,
} from "@l4dstats/contracts";
import type { PreparedDemoProjection } from "./evidence-bundle.js";

const limits = {
  bytes: 256 * 1024 * 1024,
  observations: 2_000_000,
  epochs: 65_536,
  strings: 65_536,
  properties: 65_536,
  counters: 256,
  identities: 65_536,
  events: 2_000_000,
  commands: 2_000_000,
  matches: 100_000,
  witches: 1_000_000,
} as const;
const l4d2Names = [
  "health",
  "maxHealth",
  "healthBuffer",
  "lifeState",
  "incapacitated",
  "ghost",
  "versusTeam",
  "checkpointZombieKills",
  "checkpointRevives",
  "checkpointIncaps",
  "checkpointSpecialIncaps",
  "checkpointPounces",
  "highestPounceDamage",
  "longestJockeyRide",
  "frustration",
  "tongueVictim",
  "pounceVictim",
  "jockeyVictim",
  "carryVictim",
  "pummelVictim",
  "loadout",
  "activeWeaponAmmo",
] as const;

export function rehydrateNativeProjection(
  input: Uint8Array | unknown,
  expected: { readonly demoSha256: string; readonly bytes: number },
): Omit<PreparedDemoProjection, "parserVersion" | "parser"> {
  const value = input instanceof Uint8Array ? parse(input) : input;
  const root = object(value, "artifact");
  exact(
    root,
    [
      "version",
      "header",
      "framingIssues",
      "bytesConsumed",
      "stopped",
      "projection",
      "rawEvents",
      "eventSummary",
      "sourcePerspective",
      "recorderCommands",
      "commandTelemetrySummary",
    ],
    "artifact",
  );
  if (integer(root.version, "version", 2) !== 2) fail("version must be 2");
  const header = readHeader(root.header);
  const projection = object(root.projection, "projection");
  exact(
    projection,
    [
      "demoSha256",
      "epochs",
      "displayIdentities",
      "identityMappings",
      "rejectedIdentityEntries",
      "serverInfo",
      "matchStates",
      "witchObservations",
      "coverage",
      "observations",
    ],
    "projection",
  );
  const demoSha256 = string(projection.demoSha256, "projection.demoSha256", 64);
  if (!/^[a-f0-9]{64}$/.test(demoSha256))
    fail("projection.demoSha256 is invalid");
  if (demoSha256 !== expected.demoSha256)
    fail("projection.demoSha256 does not match the input");
  integer(expected.bytes, "expected input bytes", Number.MAX_SAFE_INTEGER);
  integer(root.bytesConsumed, "bytesConsumed", expected.bytes);
  boolean(root.stopped, "stopped");
  const epochs = array(
    projection.epochs,
    "projection.epochs",
    limits.epochs,
  ).map(readEpoch(demoSha256));
  const observationWire = object(
    projection.observations,
    "projection.observations",
  );
  exact(
    observationWire,
    ["epochs", "strings", "counters", "propertyPaths", "rows"],
    "projection.observations",
  );
  const epochRegistry = strings(
    observationWire.epochs,
    "epochs",
    limits.epochs,
  );
  if (new Set(epochRegistry).size !== epochRegistry.length)
    fail("epoch registry repeats a value");
  const epochIds = new Set(epochs.map(({ id }) => id));
  if (epochRegistry.some((id) => !epochIds.has(id)))
    fail("epoch registry references an unknown epoch");
  const stringRegistry = strings(
    observationWire.strings,
    "strings",
    limits.strings,
  );
  const counterRegistry = strings(
    observationWire.counters,
    "counters",
    limits.counters,
  );
  const propertyPaths = strings(
    observationWire.propertyPaths,
    "propertyPaths",
    limits.properties,
  );
  for (const [name, values] of [
    ["strings", stringRegistry],
    ["counters", counterRegistry],
    ["propertyPaths", propertyPaths],
  ] as const)
    if (new Set(values).size !== values.length)
      fail(`${name} registry repeats a value`);
  const rows = array(observationWire.rows, "rows", limits.observations);
  const observations = rows.map((row, index) =>
    readObservation(
      row,
      index,
      demoSha256,
      header,
      epochRegistry,
      stringRegistry,
      counterRegistry,
      propertyPaths,
    ),
  );
  const serverInfo =
    projection.serverInfo === null ? null : readServer(projection.serverInfo);
  const sourcePerspective =
    root.sourcePerspective === undefined
      ? serverInfo === null
        ? ("unknown" as const)
        : serverInfo.isSourceTv
          ? ("source-tv" as const)
          : ("player-pov" as const)
      : readPerspective(root.sourcePerspective);
  const recorderCommands =
    root.recorderCommands === undefined
      ? []
      : array(root.recorderCommands, "recorderCommands", limits.commands).map(
          (command, index) =>
            readRecorderCommand(
              command,
              index,
              demoSha256,
              header.playbackTicks > 0 && header.playbackTimeSeconds > 0
                ? header.playbackTimeSeconds / header.playbackTicks
                : null,
            ),
        );
  const commandSummary =
    root.commandTelemetrySummary === undefined
      ? null
      : readCommandSummary(root.commandTelemetrySummary);
  return {
    demoSha256,
    bytes: expected.bytes,
    header,
    decodeIssues: array(root.framingIssues, "framingIssues", 10_000).map(
      readIssue,
    ),
    tickIntervalSeconds:
      header.playbackTicks > 0 && header.playbackTimeSeconds > 0
        ? header.playbackTimeSeconds / header.playbackTicks
        : null,
    identity: {
      mappings: array(
        projection.identityMappings,
        "identityMappings",
        limits.identities,
      ).map(readMapping),
      displayIdentities: array(
        projection.displayIdentities,
        "displayIdentities",
        limits.identities,
      ).map(readDisplay),
      rejectedEntries: integer(
        projection.rejectedIdentityEntries,
        "rejectedIdentityEntries",
        limits.identities,
      ),
    },
    observations,
    witchObservations: array(
      projection.witchObservations,
      "witchObservations",
      limits.witches,
    ).map(readWitch),
    playerEpochs: epochs,
    projectionCoverage: readCoverage(projection.coverage),
    matchStates: array(
      projection.matchStates,
      "matchStates",
      limits.matches,
    ).map(readMatch),
    serverInfo,
    sourcePerspective,
    recorderCommands,
    recorderCommandCoverage: {
      availability:
        commandSummary !== null && sourcePerspective === "player-pov"
          ? "observed"
          : "unavailable",
      totalCommands: commandSummary?.commands ?? 0,
      decodedCommands: commandSummary?.decodedCommands ?? 0,
      malformedCommands: commandSummary?.malformedCommands ?? 0,
      commandGaps: commandSummary?.gaps ?? 0,
      firstDemoTick: commandSummary?.firstDemoTick ?? null,
      lastDemoTick: commandSummary?.lastDemoTick ?? null,
      recorderPlayerEpochId: {
        availability: "unavailable",
        reason:
          sourcePerspective === "source-tv"
            ? "SourceTV does not carry per-player user commands"
            : "recorder identity cannot be established from a demo-local command slot alone",
      },
      ...(sourcePerspective === "source-tv"
        ? {
            unavailableReason:
              "SourceTV does not carry per-player user commands",
          }
        : commandSummary === null
          ? {
              unavailableReason:
                "recorder command telemetry was not present in compact wire v2",
            }
          : {}),
    },
    eventSummary: readEventSummary(root.eventSummary),
    eventVisits: array(root.rawEvents, "rawEvents", limits.events).map(
      (visit, i) => readEventVisit(visit, i),
    ),
  };
}

function readObservation(
  value: unknown,
  index: number,
  hash: string,
  header: DemoHeader,
  epochs: string[],
  strings: string[],
  counters: string[],
  paths: string[],
): ProjectedPlayerObservation {
  const row = tuple(value, 10, `rows[${index}]`);
  const epoch = epochs[indexOf(row[0], epochs, `rows[${index}].epoch`)]!;
  const tick = integer(row[1], `rows[${index}].tick`, 0x7fffffff, -0x80000000);
  const entityIndex = integer(row[2], `rows[${index}].entityIndex`, 0x7ff);
  const position = vector(row[3], `rows[${index}].position`);
  const angles = vector(row[4], `rows[${index}].eyeAngles`);
  const team = nullableNumber(row[5], `rows[${index}].team`);
  const playerClass = nullableIndex(
    row[6],
    strings,
    `rows[${index}].playerClass`,
  );
  const weapon = nullableIndex(row[7], strings, `rows[${index}].weapon`);
  const l4d2 = readL4d2(row[8], strings, counters, entityIndex, index);
  const p = tuple(row[9], 9, `rows[${index}].provenance`);
  const demoTime = nullableNumber(p[0], "demoTimeSeconds");
  const positionForm = integer(p[1], "positionForm", 3);
  const positionPaths = indexes(p[2], paths, "positionPaths");
  const eyeForm = integer(p[3], "eyeForm", 3);
  const eyePaths = indexes(p[4], paths, "eyePaths");
  const teamPath = nullableIndex(p[5], paths, "teamPath");
  const classPath = nullableIndex(p[6], paths, "classPath");
  const weaponTag = integer(p[7], "weaponTag", 2);
  const weaponPath = nullableIndex(p[8], paths, "weaponPath");
  if ((position === null) !== (positionForm === 0))
    fail(`rows[${index}] position provenance disagrees with value`);
  if ((angles === null) !== (eyeForm === 0))
    fail(`rows[${index}] eye provenance disagrees with value`);
  if ((weapon === null) !== (weaponTag !== 2))
    fail(`rows[${index}] weapon provenance disagrees with value`);
  const unavailable = <T>(reason: string): AvailableValue<T> => ({
    availability: "unavailable",
    reason,
  });
  const observed = <T>(value: T): AvailableValue<T> => ({
    availability: "observed",
    value,
  });
  return {
    observation: {
      schemaVersion: 1,
      demoSha256: hash,
      playerEpochId: epoch,
      tick,
      demoTimeSeconds:
        demoTime === null
          ? unavailable("tick interval was not supplied")
          : { availability: "derived", value: demoTime },
      position:
        position === null
          ? unavailable("complete networked origin XYZ was unavailable")
          : observed({ x: position[0], y: position[1], z: position[2] }),
      eyeAngles:
        angles === null
          ? unavailable("networked eye pitch and yaw were unavailable")
          : {
              availability: "derived",
              value: { pitch: angles[0], yaw: angles[1], roll: angles[2] },
            },
      team:
        team === null
          ? unavailable("networked team was unavailable")
          : observed(team),
      playerClass:
        playerClass === null
          ? unavailable("networked zombie class was unavailable")
          : observed(playerClass),
      weapon:
        weapon === null
          ? unavailable(
              weaponTag === 0
                ? "active weapon handle was unavailable"
                : "active weapon handle did not resolve to an active network entity",
            )
          : observed(weapon),
      buttons: unavailable(
        "SourceTV does not contain per-player user-command buttons",
      ),
    },
    l4d2,
    provenance: {
      demoTimeSeconds:
        demoTime === null
          ? prov([], "unavailable", "tick interval was not supplied")
          : prov([], "derived-engine-tick"),
      position:
        position === null
          ? prov(
              [],
              "unavailable",
              "complete networked origin XYZ was unavailable",
            )
          : prov(positionPaths, "network-send-property"),
      eyeAngles:
        angles === null
          ? prov(
              [],
              "unavailable",
              "networked eye pitch and yaw were unavailable",
            )
          : eyeForm === 2
            ? prov(
                eyePaths,
                "derived-network-normalization",
                "L4D2 networks player eye pitch/yaw only; canonical roll is explicitly normalized to zero",
              )
            : prov(eyePaths, "network-send-property"),
      team:
        team === null
          ? prov([], "unavailable", "networked team was unavailable")
          : prov(teamPath === null ? [] : [teamPath], "network-send-property"),
      playerClass:
        playerClass === null
          ? prov([], "unavailable", "networked zombie class was unavailable")
          : prov(
              classPath === null ? [] : [classPath],
              "network-send-property",
            ),
      weapon:
        weapon === null
          ? prov(
              [],
              "unavailable",
              weaponTag === 0
                ? "active weapon handle was unavailable"
                : "active weapon handle did not resolve to an active network entity",
            )
          : prov(
              weaponPath === null ? [] : [weaponPath],
              "network-send-property",
            ),
      buttons: prov(
        [],
        "unavailable",
        "SourceTV does not contain per-player user-command buttons",
      ),
    },
  };
}

function readL4d2(
  value: unknown,
  strings: string[],
  counters: string[],
  entity: number,
  rowIndex: number,
): L4d2PlayerState {
  const row = array(value, `rows[${rowIndex}].l4d2`, 26);
  if (row.length < 3 || integer(row[0], "l4d2.entityIndex", 0x7ff) !== entity)
    fail("L4D2 entity index mismatch");
  const mask = integer(row[1], "l4d2.mask", (1 << 22) - 1);
  const out: Record<string, unknown> = { entityIndex: entity };
  let cursor = 2;
  for (let bit = 0; bit < 22; bit++)
    if (mask & (1 << bit)) {
      const raw = row[cursor++];
      const name = l4d2Names[bit]!;
      if (bit === 4 || bit === 5) out[name] = boolean(raw, name);
      else if (bit === 7) out[name] = numbers(raw, name, 128);
      else if (bit === 20) out[name] = readLoadout(raw);
      else if (bit === 21) out[name] = readAmmo(raw, strings);
      else out[name] = number(raw, name);
    }
  const counterValues = tuple(row[cursor++], counters.length, "counterValues");
  if (cursor !== row.length)
    fail("L4D2 row length does not match presence mask");
  out.counters = Object.fromEntries(
    counterValues.flatMap((v, i) =>
      v === null ? [] : [[counters[i]!, number(v, `counterValues[${i}]`)]],
    ),
  );
  return out as unknown as L4d2PlayerState;
}

function readLoadout(v: unknown): L4d2PlayerLoadout {
  const r = tuple(v, 3, "loadout");
  return {
    ...(r[0] === null
      ? {}
      : { primaryWeaponId: number(r[0], "primaryWeaponId") }),
    ...(r[1] === null
      ? {}
      : { firstAidSlotId: number(r[1], "firstAidSlotId") }),
    ...(r[2] === null ? {} : { pillsSlotId: number(r[2], "pillsSlotId") }),
  };
}
function readAmmo(v: unknown, s: string[]): L4d2ActiveWeaponAmmo {
  const r = tuple(v, 7, "ammo");
  return {
    ...(r[0] === null
      ? {}
      : { weaponClass: s[indexOf(r[0], s, "ammo class")] }),
    ...(r[1] === null ? {} : { primaryAmmoType: number(r[1], "ammo type") }),
    ...(r[2] === null ? {} : { clip: number(r[2], "clip") }),
    ...(r[3] === null ? {} : { reserve: number(r[3], "reserve") }),
    ...(r[4] === null ? {} : { reloading: boolean(r[4], "reloading") }),
    ...(r[5] === null ? {} : { extraPrimaryAmmo: number(r[5], "extra ammo") }),
    ...(r[6] === null
      ? {}
      : { upgradedAmmoLoaded: number(r[6], "upgraded ammo") }),
  };
}
const readEpoch =
  (hash: string) =>
  (v: unknown, i: number): PlayerEpoch => {
    const o = camel(
      v,
      [
        "id",
        "entitySlot",
        "lifetime",
        "userId",
        "stableToken",
        "connectedAtTick",
        "disconnectedAtTick",
      ],
      `epochs[${i}]`,
    );
    const missing = <T>(reason: string): AvailableValue<T> => ({
      availability: "unavailable",
      reason,
    });
    return {
      id: string(o.id, "epoch.id"),
      demoSha256: hash,
      entitySlot: integer(o.entitySlot, "entitySlot", 0x7ff),
      userId:
        o.userId === null
          ? missing("userinfo user ID was not mapped")
          : {
              availability: "observed",
              value: integer(o.userId, "userId", 0x7fffffff, -0x80000000),
            },
      steamId:
        o.stableToken === null
          ? missing("privacy-safe stable identity token was not supplied")
          : {
              availability: "observed",
              value: string(o.stableToken, "stableToken"),
            },
      connectedAtTick: integer(
        o.connectedAtTick,
        "connectedAtTick",
        0x7fffffff,
        -0x80000000,
      ),
      disconnectedAtTick:
        o.disconnectedAtTick === null
          ? missing("entity lifetime remained active at end of decoded range")
          : {
              availability: "observed",
              value: integer(
                o.disconnectedAtTick,
                "disconnectedAtTick",
                0x7fffffff,
                -0x80000000,
              ),
            },
    };
  };
function readHeader(v: unknown): DemoHeader {
  const o = camel(
    v,
    [
      "stamp",
      "demoProtocol",
      "networkProtocol",
      "serverName",
      "clientName",
      "mapName",
      "gameDirectory",
      "playbackTimeSeconds",
      "playbackTicks",
      "playbackFrames",
      "signonLength",
    ],
    "header",
  );
  const stamp = string(o.stamp, "header.stamp", 8);
  if (stamp !== "HL2DEMO") fail("header.stamp is invalid");
  return {
    stamp,
    demoProtocol: integer(o.demoProtocol, "demoProtocol", 4, 3),
    networkProtocol: integer(o.networkProtocol, "networkProtocol", 65535),
    serverName: string(o.serverName, "serverName", 259),
    clientName: string(o.clientName, "clientName", 259),
    mapName: string(o.mapName, "mapName", 259),
    gameDirectory: string(o.gameDirectory, "gameDirectory", 259),
    playbackTimeSeconds: number(o.playbackTimeSeconds, "playbackTimeSeconds"),
    playbackTicks: integer(o.playbackTicks, "playbackTicks", 0x7fffffff),
    playbackFrames: integer(o.playbackFrames, "playbackFrames", 0x7fffffff),
    signonLength: integer(o.signonLength, "signonLength", 0x7fffffff),
  };
}
function readIssue(v: unknown): DecodeIssue {
  return camel(
    v,
    ["code", "offset", "command", "message"],
    "issue",
  ) as unknown as DecodeIssue;
}
function readMapping(v: unknown): ProjectableUserInfo {
  const o = camel(
    v,
    [
      "entityIndex",
      "userInfoSlot",
      "userId",
      "effectiveTick",
      "stableIdentityToken",
    ],
    "mapping",
  );
  return {
    entityIndex: integer(o.entityIndex, "entityIndex", 0x7ff),
    userInfoSlot: integer(o.userInfoSlot, "userInfoSlot", 65535),
    ...(o.userId === null
      ? {}
      : { userId: integer(o.userId, "userId", 0x7fffffff, -0x80000000) }),
    ...(o.effectiveTick === null
      ? {}
      : {
          effectiveTick: integer(
            o.effectiveTick,
            "effectiveTick",
            0x7fffffff,
            -0x80000000,
          ),
        }),
    ...(o.stableIdentityToken === null
      ? {}
      : {
          stableIdentityToken: string(
            o.stableIdentityToken,
            "stableIdentityToken",
          ),
        }),
  };
}
function readDisplay(v: unknown): DisplayUserInfoIdentity {
  const o = camel(
    v,
    [
      "entityIndex",
      "userInfoSlot",
      "userId",
      "effectiveTick",
      "displayName",
      "fakePlayer",
      "steamId64",
    ],
    "display",
  );
  return {
    entityIndex: integer(o.entityIndex, "entityIndex", 0x7ff),
    userInfoSlot: integer(o.userInfoSlot, "userInfoSlot", 65535),
    userId: integer(o.userId, "userId", 0x7fffffff, -0x80000000),
    ...(o.effectiveTick === null
      ? {}
      : {
          effectiveTick: integer(
            o.effectiveTick,
            "effectiveTick",
            0x7fffffff,
            -0x80000000,
          ),
        }),
    displayName: string(o.displayName, "displayName", 4096),
    fakePlayer: boolean(o.fakePlayer, "fakePlayer"),
    ...(o.steamId64 === null
      ? {}
      : { steamId64: string(o.steamId64, "steamId64", 32) }),
  };
}
function readWitch(v: unknown): L4d2WitchObservation {
  const o = camel(
    v,
    [
      "entityIndex",
      "lifetime",
      "tick",
      "timeSeconds",
      "cellRelativeOrigin",
      "rage",
      "wanderRage",
      "burning",
    ],
    "witch",
  );
  return {
    entityIndex: integer(o.entityIndex, "entityIndex", 0x7ff),
    lifetime: integer(o.lifetime, "lifetime", Number.MAX_SAFE_INTEGER),
    tick: integer(o.tick, "tick", 0x7fffffff, -0x80000000),
    ...(o.timeSeconds === null
      ? {}
      : { timeSeconds: number(o.timeSeconds, "timeSeconds") }),
    ...(o.cellRelativeOrigin === null
      ? {}
      : (() => {
          const x = vector(o.cellRelativeOrigin, "cellRelativeOrigin")!;
          return { cellRelativeOrigin: { x: x[0], y: x[1], z: x[2] } };
        })()),
    ...(o.rage === null ? {} : { rage: number(o.rage, "rage") }),
    ...(o.wanderRage === null
      ? {}
      : { wanderRage: number(o.wanderRage, "wanderRage") }),
    ...(o.burning === null ? {} : { burning: boolean(o.burning, "burning") }),
  };
}
function readMatch(v: unknown): L4d2MatchState {
  const o = camel(
    v,
    [
      "tick",
      "campaignScores",
      "chapterScores",
      "survivorScores",
      "survivorDistances",
      "survivorDeathDistances",
      "roundDurations",
      "roundNumber",
      "teamsFlipped",
      "secondHalf",
      "voteRestarting",
      "roundSetupTimeRemaining",
    ],
    "match",
  );
  const nullable = (value: unknown, name: string, len: number) =>
    tuple(value, len, name).map((x, i) =>
      x === null ? null : number(x, `${name}[${i}]`),
    );
  return {
    tick: integer(o.tick, "match.tick", 0x7fffffff, -0x80000000),
    campaignScores: nullable(o.campaignScores, "campaignScores", 2),
    chapterScores: nullable(o.chapterScores, "chapterScores", 2),
    survivorScores: nullable(o.survivorScores, "survivorScores", 2),
    survivorDistances: nullable(o.survivorDistances, "survivorDistances", 8),
    survivorDeathDistances: nullable(
      o.survivorDeathDistances,
      "survivorDeathDistances",
      8,
    ),
    roundDurations: nullable(o.roundDurations, "roundDurations", 2),
    ...(o.roundNumber === null
      ? {}
      : { roundNumber: number(o.roundNumber, "roundNumber") }),
    ...(o.teamsFlipped === null
      ? {}
      : { teamsFlipped: boolean(o.teamsFlipped, "teamsFlipped") }),
    ...(o.secondHalf === null
      ? {}
      : { secondHalf: boolean(o.secondHalf, "secondHalf") }),
    ...(o.voteRestarting === null
      ? {}
      : { voteRestarting: boolean(o.voteRestarting, "voteRestarting") }),
    ...(o.roundSetupTimeRemaining === null
      ? {}
      : {
          roundSetupTimeRemaining: number(
            o.roundSetupTimeRemaining,
            "roundSetupTimeRemaining",
          ),
        }),
  };
}
function readServer(v: unknown): L4d2ServerInfo {
  return camel(
    v,
    [
      "networkProtocol",
      "serverCount",
      "isSourceTv",
      "dedicated",
      "maxServerClasses",
      "playerCount",
      "maxClients",
      "tickIntervalSeconds",
      "platformCode",
    ],
    "serverInfo",
  ) as unknown as L4d2ServerInfo;
}
function readCoverage(v: unknown): PlayerProjectionCoverage {
  const o = camel(
    v,
    ["framesVisited", "observationsEmitted", "fieldAvailability"],
    "coverage",
  );
  const fields = object(o.fieldAvailability, "fieldAvailability"),
    output: Record<
      string,
      { observed: number; derived: number; unavailable: number }
    > = {};
  if (Object.keys(fields).length > 32) fail("fieldAvailability limit exceeded");
  for (const [name, value] of Object.entries(fields)) {
    string(name, "coverage field", 64);
    const c = camel(
      value,
      ["observed", "derived", "unavailable"],
      `coverage.${name}`,
    );
    output[name] = {
      observed: integer(c.observed, "observed", limits.observations),
      derived: integer(c.derived, "derived", limits.observations),
      unavailable: integer(c.unavailable, "unavailable", limits.observations),
    };
  }
  return {
    framesVisited: integer(o.framesVisited, "framesVisited", 10_000_000),
    observationsEmitted: integer(
      o.observationsEmitted,
      "observationsEmitted",
      limits.observations,
    ),
    fieldAvailability: output,
  } as PlayerProjectionCoverage;
}
function readEventSummary(v: unknown): GameEventTelemetrySummary {
  const o = camel(
    v,
    ["schemaLists", "schemas", "events", "requiredEvents"],
    "eventSummary",
  );
  const required = object(o.requiredEvents, "requiredEvents");
  if (Object.keys(required).length > 4096)
    fail("requiredEvents limit exceeded");
  return {
    schemaLists: integer(o.schemaLists, "schemaLists", 1_000_000),
    schemas: integer(o.schemas, "schemas", 1_000_000),
    events: integer(o.events, "events", limits.events),
    requiredEvents: Object.fromEntries(
      Object.entries(required).map(([name, count]) => [
        string(name, "event name", 4096),
        integer(count, `requiredEvents.${name}`, limits.events),
      ]),
    ),
  };
}

function readPerspective(v: unknown) {
  const value = string(v, "sourcePerspective", 16);
  if (
    !(["source-tv", "player-pov", "unknown"] as const).includes(value as never)
  )
    fail("sourcePerspective is invalid");
  return value as "source-tv" | "player-pov" | "unknown";
}

function readCommandSummary(v: unknown) {
  const o = camel(
    v,
    [
      "commands",
      "decodedCommands",
      "malformedCommands",
      "firstDemoTick",
      "lastDemoTick",
      "recorderPlayerSlot",
      "recorderIdentityConfidence",
      "gaps",
    ],
    "commandTelemetrySummary",
  );
  const nullableTick = (value: unknown, name: string) =>
    value === null ? null : integer(value, name, 0x7fffffff, -0x80000000);
  if (o.recorderPlayerSlot !== null)
    integer(o.recorderPlayerSlot, "recorderPlayerSlot", 255);
  const confidence = string(
    o.recorderIdentityConfidence,
    "recorderIdentityConfidence",
    16,
  );
  if (
    !(["observed", "inferred", "unavailable"] as const).includes(
      confidence as never,
    )
  )
    fail("recorderIdentityConfidence is invalid");
  const result = {
    commands: integer(o.commands, "commands", limits.commands),
    decodedCommands: integer(
      o.decodedCommands,
      "decodedCommands",
      limits.commands,
    ),
    malformedCommands: integer(
      o.malformedCommands,
      "malformedCommands",
      limits.commands,
    ),
    firstDemoTick: nullableTick(o.firstDemoTick, "firstDemoTick"),
    lastDemoTick: nullableTick(o.lastDemoTick, "lastDemoTick"),
    gaps: integer(o.gaps, "gaps", limits.commands),
  };
  if (result.decodedCommands + result.malformedCommands !== result.commands)
    fail("command telemetry counts are inconsistent");
  return result;
}

function readRecorderCommand(
  v: unknown,
  index: number,
  demoSha256: string,
  tickIntervalSeconds: number | null,
): RecorderCommandObservation {
  const name = `recorderCommands[${index}]`;
  const o = camel(
    v,
    [
      "demoTick",
      "recorderPlayerSlot",
      "outgoingSequence",
      "commandNumber",
      "tickCount",
      "viewAngles",
      "forwardMove",
      "sideMove",
      "upMove",
      "buttons",
      "impulse",
      "weaponSelect",
      "weaponSubtype",
      "mouseDx",
      "mouseDy",
      "consumedBits",
      "sourceBits",
    ],
    name,
  );
  const demoTick = integer(
    o.demoTick,
    `${name}.demoTick`,
    0x7fffffff,
    -0x80000000,
  );
  if (o.recorderPlayerSlot !== null)
    integer(o.recorderPlayerSlot, `${name}.recorderPlayerSlot`, 255);
  const outgoingSequence = integer(
    o.outgoingSequence,
    `${name}.outgoingSequence`,
    0x7fffffff,
    -0x80000000,
  );
  const commandNumber = integer(
    o.commandNumber,
    `${name}.commandNumber`,
    0x7fffffff,
    -0x80000000,
  );
  if (outgoingSequence !== commandNumber)
    fail(`${name} command number does not match outgoing sequence`);
  const angles = tuple(o.viewAngles, 3, `${name}.viewAngles`).map((value, i) =>
    number(value, `${name}.viewAngles[${i}]`),
  );
  const optionalInteger = (value: unknown, field: string, max: number) =>
    value === null ? null : integer(value, `${name}.${field}`, max);
  const consumedBits = integer(o.consumedBits, `${name}.consumedBits`, 8192);
  const sourceBits = integer(o.sourceBits, `${name}.sourceBits`, 8192);
  if (consumedBits > sourceBits || sourceBits - consumedBits > 7)
    fail(`${name} bit consumption is invalid`);
  const weaponSelect = optionalInteger(o.weaponSelect, "weaponSelect", 0x7ff);
  const weaponSubtype = optionalInteger(o.weaponSubtype, "weaponSubtype", 0x3f);
  return {
    schemaVersion: 1,
    demoSha256,
    demoTick,
    demoTimeSeconds:
      tickIntervalSeconds === null
        ? {
            availability: "unavailable",
            reason: "demo tick interval unavailable",
          }
        : { availability: "derived", value: demoTick * tickIntervalSeconds },
    recorderPlayerEpochId: {
      availability: "unavailable",
      reason:
        "recorder identity cannot be established from a demo-local command slot alone",
    },
    outgoingSequence,
    commandNumber,
    clientTickCount: integer(
      o.tickCount,
      `${name}.tickCount`,
      0x7fffffff,
      -0x80000000,
    ),
    viewAngles: { pitch: angles[0]!, yaw: angles[1]!, roll: angles[2]! },
    intendedMovement: {
      forward: number(o.forwardMove, `${name}.forwardMove`),
      side: number(o.sideMove, `${name}.sideMove`),
      up: number(o.upMove, `${name}.upMove`),
    },
    buttons: integer(o.buttons, `${name}.buttons`, 0xffffffff),
    impulse: integer(o.impulse, `${name}.impulse`, 0xff),
    weaponSelect:
      weaponSelect === null
        ? { availability: "unavailable", reason: "no weapon selection encoded" }
        : { availability: "observed", value: weaponSelect },
    weaponSubtype:
      weaponSubtype === null
        ? { availability: "unavailable", reason: "no weapon subtype encoded" }
        : { availability: "observed", value: weaponSubtype },
    mouseDelta: {
      x: integer(o.mouseDx, `${name}.mouseDx`, 0x7fff, -0x8000),
      y: integer(o.mouseDy, `${name}.mouseDy`, 0x7fff, -0x8000),
    },
    provenance: {
      source: "dem_usercmd",
      scope: "recorder-only",
      semantics: "client-command-intent",
    },
  };
}
function readEventVisit(v: unknown, i: number): GameEventVisit {
  const o = camel(
    v,
    ["demoTick", "engineTick", "event", "required"],
    `event[${i}]`,
  );
  integer(o.demoTick, "demoTick", 0x7fffffff, -0x80000000);
  if (o.engineTick !== null) integer(o.engineTick, "engineTick", 0xffffffff);
  readDecodedEvent(o.event);
  if (o.required !== null) readRequiredEvent(o.required);
  return o as unknown as GameEventVisit;
}
function readDecodedEvent(v: unknown) {
  const o = camel(v, ["id", "name", "fields", "schema"], "decoded event");
  integer(o.id, "event.id", 511);
  string(o.name, "event.name", 4096);
  const fields = object(o.fields, "event.fields");
  if (Object.keys(fields).length > 128) fail("event field limit exceeded");
  for (const [name, value] of Object.entries(fields)) {
    string(name, "event field", 4096);
    if (typeof value === "number") number(value, name);
    else if (typeof value !== "string" && typeof value !== "boolean")
      fail("event field primitive is invalid");
  }
  const schema = camel(o.schema, ["id", "name", "fields"], "event.schema");
  integer(schema.id, "schema.id", 511);
  string(schema.name, "schema.name", 4096);
  for (const field of array(schema.fields, "schema.fields", 128)) {
    const f = camel(field, ["name", "type"], "schema field");
    string(f.name, "field.name", 4096);
    if (
      ![
        "string",
        "float",
        "long",
        "short",
        "byte",
        "boolean",
        "uint64",
      ].includes(string(f.type, "field.type", 16))
    )
      fail("event field type is invalid");
  }
}
function readRequiredEvent(v: unknown) {
  const o = camel(
    v,
    [
      "name",
      "eventId",
      "tick",
      "actorUserId",
      "victimUserId",
      "attackerUserId",
      "attackerEntityId",
      "weapon",
      "damage",
      "health",
      "damageType",
      "decoded",
    ],
    "required event",
  );
  string(o.name, "required.name", 64);
  integer(o.eventId, "eventId", 511);
  integer(o.tick, "event tick", 0x7fffffff, -0x80000000);
  for (const key of [
    "actorUserId",
    "victimUserId",
    "attackerUserId",
    "attackerEntityId",
    "weapon",
    "damage",
    "health",
    "damageType",
  ]) {
    const a = object(o[key], key),
      availability = string(a.availability, `${key}.availability`, 16);
    if (availability === "observed") {
      exact(a, ["availability", "value", "provenance"], key);
      if (typeof a.value === "number") number(a.value, `${key}.value`);
      else string(a.value, `${key}.value`, 4096);
      const p = camel(
        a.provenance,
        ["message", "eventId", "field"],
        `${key}.provenance`,
      );
      if (p.message !== "svc_GameEvent")
        fail("event provenance message is invalid");
      integer(p.eventId, "provenance.eventId", 511);
      string(p.field, "provenance.field", 4096);
    } else if (availability === "unavailable") {
      exact(a, ["availability", "reason"], key);
      string(a.reason, `${key}.reason`, 4096);
    } else fail("event availability is invalid");
  }
  readDecodedEvent(o.decoded);
}
function prov(
  properties: string[],
  source: ProjectedPlayerObservation["provenance"]["position"]["source"],
  reason?: string,
) {
  return { source, properties, ...(reason === undefined ? {} : { reason }) };
}
function parse(bytes: Uint8Array): unknown {
  if (bytes.byteLength > limits.bytes) fail("artifact byte limit exceeded");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("artifact is not valid JSON");
  }
}
function fail(message: string): never {
  throw new RangeError(`native projection: ${message}`);
}
function object(v: unknown, n: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v))
    fail(`${n} must be an object`);
  return v as Record<string, unknown>;
}
function exact(o: Record<string, unknown>, keys: string[], n: string) {
  if (Object.keys(o).sort().join("\n") !== [...keys].sort().join("\n"))
    fail(`${n} fields are invalid`);
}
function camel(v: unknown, keys: string[], n: string) {
  const o = object(v, n);
  exact(o, keys, n);
  return o;
}
function array(v: unknown, n: string, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail(`${n} must be a bounded array`);
  return v;
}
function tuple(v: unknown, len: number, n: string): unknown[] {
  const a = array(v, n, len);
  if (a.length !== len) fail(`${n} must have ${len} fields`);
  return a;
}
function string(v: unknown, n: string, max = 4096): string {
  if (typeof v !== "string" || v.length > max)
    fail(`${n} must be a bounded string`);
  return v;
}
function strings(v: unknown, n: string, max: number) {
  return array(v, n, max).map((x, i) => string(x, `${n}[${i}]`));
}
function number(v: unknown, n: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${n} must be finite`);
  return v;
}
function integer(v: unknown, n: string, max: number, min = 0): number {
  const x = number(v, n);
  if (!Number.isSafeInteger(x) || x < min || x > max)
    fail(`${n} is out of range`);
  return x;
}
function boolean(v: unknown, n: string): boolean {
  if (typeof v !== "boolean") fail(`${n} must be boolean`);
  return v;
}
function nullableNumber(v: unknown, n: string) {
  return v === null ? null : number(v, n);
}
function indexOf(v: unknown, registry: string[], n: string) {
  return integer(v, n, registry.length - 1);
}
function nullableIndex(v: unknown, r: string[], n: string) {
  return v === null ? null : r[indexOf(v, r, n)]!;
}
function indexes(v: unknown, r: string[], n: string) {
  return array(v, n, 16).map((x, i) => r[indexOf(x, r, `${n}[${i}]`)]!);
}
function vector(v: unknown, n: string): [number, number, number] | null {
  if (v === null) return null;
  const r = tuple(v, 3, n);
  return [number(r[0], n), number(r[1], n), number(r[2], n)];
}
function numbers(v: unknown, n: string, max: number) {
  return array(v, n, max).map((x, i) => number(x, `${n}[${i}]`));
}
