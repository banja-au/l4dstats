import { createHash, createHmac } from "node:crypto";
import type {
  DecodeIssue,
  DemoHeader,
  DemoSourcePerspective,
  DisplayUserInfoIdentity,
  GameEventTelemetrySummary,
  GameEventVisit,
  L4d2MatchState,
  L4d2ServerInfo,
  L4d2WitchObservation,
  PlayerEpoch,
  PlayerProjectionCoverage,
  ProjectableUserInfo,
  ProjectedPlayerObservation,
  RecorderCommandCoverage,
  RecorderCommandObservation,
} from "@l4dstats/contracts";
import {
  buildRealAimEvidence,
  defaultAimConfig,
  type PlayerRealEvidence,
} from "@l4dstats/detectors";
import { l4d2CounterNames, l4d2WeaponIdentity } from "./l4d2-domain.js";

const CONTEXT_SECONDS = 8;
const MAX_WINDOW_TICKS = 600;
const MAX_WINDOW_OBSERVATIONS = 512;
// Leave headroom beneath storage's 256 KiB hard limit for transport wrappers.
const MAX_WINDOW_PAYLOAD_BYTES = 240 * 1024;

interface BundleCase {
  id: string;
  playerKey: string;
  status: "unreviewed";
  score: unknown;
  evidence: readonly unknown[];
  windows: { startTick: number; endTick: number; payload: unknown }[];
  versions: {
    parser: string;
    schema: string;
    detectors: string[];
    model: string;
  };
  config: unknown;
  map: { name: string; assetVersion: string };
  derivation: string[];
  limitations: string[];
  presentation: {
    schemaVersion: 1;
    id: string;
    alias: string;
    identityLabel: string;
    provenance: { controlledFixture: false; label: string };
    demos: Array<{
      id: string;
      sha256: string;
      mapName: string;
      sourceLabel: string;
      quality: { value: number | null; basis: string[] };
      corroboration: "unassociated" | "same-stable-player";
    }>;
    evidence: Array<{
      id: string;
      family: string;
      title: string;
      tick: number;
      tickRange: { start: number; end: number };
      quality: { value: number; basis: string[] };
      contribution: null;
      explanation: string;
      counterevidence: string[];
      limitations: string[];
      demoSha256: string;
      window: { startTick: number; endTick: number; contextSeconds: number };
    }>;
    association:
      | {
          kind: "demo-local-epoch";
          corroboratingDemoCount: 0;
          explanation: string;
        }
      | {
          kind: "stable-privacy-token";
          stableToken: string;
          corroboratingDemoCount: number;
          explanation: string;
        };
    summary: { encounterCount: number; independentSignalFamilies: string[] };
  };
}

export interface DemoSessionEvidence {
  serverToken: string | null;
  rosterToken: string | null;
  serverCount: number | null;
  campaign: string | null;
  chapter: number | null;
  evidence: string[];
}

export interface EvidenceBundle {
  schemaVersion: 1;
  demo: {
    parser: ParserLineage;
    sha256: string;
    mapName: string;
    bytes: number;
    session: DemoSessionEvidence;
    stats: DemoStats;
  };
  cases: BundleCase[];
}

export interface ParserLineage {
  engine: "rust-native";
  coreVersion: string;
  bindingVersion: string | null;
  bindingApiVersion: number | null;
  configVersion: number;
  wireVersion: number;
  parserConfigId: string;
  buildSha256: string | null;
}

export interface RecorderCommandEvidence {
  availability: "observed" | "unavailable";
  scope: "recorder-only";
  semantics: "client-command-intent";
  totalCommands: number;
  decodedCommands: number;
  malformedCommands: number;
  commandGaps: number;
  demoTickRange: { start: number; end: number } | null;
  recorderPlayerEpochId: string | null;
  recorderIdentityAvailability: "observed" | "derived" | "unavailable";
  heldCommandCounts: Record<
    "attack" | "secondaryAttack" | "reload" | "jump" | "duck" | "use",
    number
  >;
  pressCounts: Record<
    "attack" | "secondaryAttack" | "reload" | "jump" | "duck" | "use",
    number
  >;
  intendedMovementCommands: number;
  nonzeroMouseDeltaCommands: number;
  limitations: string[];
}

export interface DemoStats {
  sourcePerspective: DemoSourcePerspective;
  evidenceSemantics: {
    recorderCommands: "client-command-intent";
    playerState: "server-observed-state";
    gameEvents: "gameplay-outcome";
  };
  recorderCommandEvidence: RecorderCommandEvidence;
  durationSeconds: number;
  playbackTicks: number;
  tickRate: number | null;
  playerCount: number;
  observationCount: number;
  eventCount: number;
  requiredEvents: Record<string, number>;
  decodeIssueCount: number;
  availability: {
    position: number;
    eyeAngles: number;
    team: number;
    playerClass: number;
    weapon: number;
  };
  match: {
    roundStarts: number;
    roundEnds: number;
    survivorDeaths: number;
    specialInfectedDeaths: number;
    tankDeaths: number;
    witchDeaths: number;
    specialKillsByClass: Record<string, number>;
    killsByWeapon: Record<string, number>;
    campaignScores: Array<number | null>;
    chapterScores: Array<number | null>;
    survivorScores: Array<number | null>;
    survivorDistances: Array<number | null>;
    survivorDeathDistances: Array<number | null>;
    roundDurations: Array<number | null>;
    roundNumber: number | null;
    teamsFlipped: boolean | null;
    secondHalf: boolean | null;
    scoreTimeline: Array<{
      tick: number;
      timeSeconds: number;
      campaignScores: Array<number | null>;
      chapterScores: Array<number | null>;
      survivorScores: Array<number | null>;
      survivorDistances: Array<number | null>;
      teamsFlipped: boolean | null;
      secondHalf: boolean | null;
      voteRestarting: boolean | null;
      roundSetupTimeRemaining: number | null;
    }>;
  };
  timeline: Array<{
    tick: number;
    timeSeconds: number;
    type:
      | "round_start"
      | "round_end"
      | "death"
      | "damage"
      | "team_change"
      | "spawn"
      | "pin_start"
      | "pin_end"
      | "incap"
      | "revive"
      | "tank_control"
      | "attack"
      | "clear"
      | "witch_spawn"
      | "witch_enrage"
      | "witch_burn"
      | "witch_end";
    actor?: string;
    actorPlayerId?: string;
    victim?: string;
    victimPlayerId?: string;
    subject?: string;
    subjectPlayerId?: string;
    weapon?: string;
    infectedClass?: string;
    headshot?: boolean;
    evidenceClass?:
      | "client-command-intent"
      | "server-observed-state"
      | "gameplay-outcome";
    damage?: number;
    damageType?: number;
    attackerEntityIndex?: number;
    detail: string;
    position?: { x: number; y: number; z: number };
  }>;
  competitive: CompetitiveStats;
  witchEncounters: Array<{
    id: string;
    entityIndex: number;
    tickRange: { start: number; end: number };
    timeRange: { start: number | null; end: number | null };
    enragedTick: number | null;
    burningTick: number | null;
    peakRage: number | null;
    peakWanderRage: number | null;
    sampleCount: number;
    endReason: "death-correlated" | "despawn-or-demo-end";
  }>;
  survivorHealthTraces: Array<{
    playerId: string;
    playerAlias: string;
    sourceSamples: number;
    healthCoverage: number;
    bufferCoverage: number;
    points: Array<{
      tick: number;
      timeSeconds: number;
      health: number;
      maxHealth?: number;
      healthBuffer?: number;
      incapacitated?: boolean;
      lifeState?: number;
    }>;
  }>;
  survivorLoadoutTraces: SurvivorLoadoutTrace[];
  survivorAmmoTraces: SurvivorAmmoTrace[];
  spectators: Array<{
    displayName: string;
    steamId64?: string;
    steamProfileUrl?: string;
  }>;
  players: Array<{
    id: string;
    alias: string;
    identity: {
      displayName: string;
      inference: "observed" | "unique-slot-v1";
      steamId64?: string;
      steamProfileUrl?: string;
    } | null;
    team: number | null;
    playerClass: string | null;
    sampleCount: number;
    durationSeconds: number;
    distanceUnits: number;
    viewTravelDegrees: number;
    observedPositionRate: number;
    observedAnglesRate: number;
    weapons: string[];
    evidenceWindows: number;
    survivorDeaths: number;
    infectedDeaths: number;
    specialInfectedKills: number;
    headshotKills: number;
    checkpointInfectedKills?: number | undefined;
    revives?: number | undefined;
    survivorIncaps?: number | undefined;
    specialIncaps?: number | undefined;
    pounces?: number | undefined;
    highestPounceDamage?: number | undefined;
    longestJockeyRide?: number | undefined;
    pinSeconds: number;
    ghostSeconds: number;
    observedHealthLost: number;
    killsByWeapon: Record<string, number>;
    killsByInfectedClass: Record<string, number>;
    playedSurvivor: boolean;
    playedInfected: boolean;
    infectedClasses: string[];
    counters: Record<string, number>;
  }>;
}

export interface SurvivorLoadoutTrace {
  playerId: string;
  playerAlias: string;
  sourceSamples: number;
  coverage: {
    primaryWeapon: number;
    firstAid: number;
    temporaryHealth: number;
  };
  points: Array<{
    tick: number;
    timeSeconds: number;
    primaryWeapon?: ReturnType<typeof l4d2WeaponIdentity> | null;
    firstAid?: ReturnType<typeof l4d2WeaponIdentity> | null;
    temporaryHealth?: ReturnType<typeof l4d2WeaponIdentity> | null;
  }>;
}

export interface SurvivorAmmoTrace {
  playerId: string;
  playerAlias: string;
  sourceSamples: number;
  coverage: number;
  points: Array<{
    tick: number;
    timeSeconds: number;
    weaponClass?: string;
    clip?: number;
    reserve?: number;
    reloading?: boolean;
    extraPrimaryAmmo?: number;
    upgradedAmmoLoaded?: number;
  }>;
}

export type ObservedOpeningArea =
  | {
      availability: "derived";
      derivation: "survivor-opening-area-v1";
      anchor: { kind: "round-start"; tick: number };
      tickRange: { start: number; end: number };
      samples: Array<{
        playerId: string;
        tick: number;
        position: { x: number; y: number; z: number };
      }>;
      center: { x: number; y: number; z: number };
      bounds: {
        min: { x: number; y: number; z: number };
        max: { x: number; y: number; z: number };
      };
      planarRadiusUnits: number;
      limitations: Array<
        | "demo-derived-not-map-authored"
        | "first-observed-position-per-player"
        | "life-state-partially-unavailable"
      >;
    }
  | {
      availability: "unavailable";
      derivation: "survivor-opening-area-v1";
      reason:
        | "round-start-unobserved"
        | "tick-rate-unavailable"
        | "insufficient-survivor-positions";
      anchor?: { kind: "round-start"; tick: number };
      observedPlayerIds: string[];
    };

export interface CompetitiveStats {
  derivationVersion: 1 | 2 | 3 | 4 | 5 | 6;
  rosters: Array<{
    id: "A" | "B";
    playerIds: string[];
    confidence: "high" | "provisional";
    inference: "side-swap-v1";
    sides: Array<{
      halfId: "first" | "second" | "unknown";
      side: "Survivor" | "Infected" | "unknown";
    }>;
  }>;
  halves: Array<{
    id: "first" | "second" | "unknown";
    secondHalf: boolean | null;
    tickRange: { start: number; end: number };
    survivorPlayerIds: string[];
    infectedPlayerIds: string[];
    observedOpeningArea?: ObservedOpeningArea;
    players: Array<{
      playerId: string;
      side: "Survivor" | "Infected";
      /** Sum of positive observed counter deltas. Counter resets are boundaries. */
      counterDeltas: Record<string, number>;
      /** Counters observed at least once in this player/side/half scope. */
      observedCounters: string[];
      summary: CompetitiveHalfPlayerSummary;
    }>;
  }>;
  infectedLives: Array<{
    id: string;
    playerId: string;
    playerAlias: string;
    infectedClass: string;
    tickRange: { start: number; end: number };
    durationSeconds: number;
    startReason: "spawn" | "already-active" | "tank-control";
    endReason: "death" | "ghost" | "team-or-class-change" | "demo-end";
    controls: number;
    pinSeconds: number;
    counterDeltas: Record<string, number>;
  }>;
  hits: Array<{
    id: string;
    tickRange: { start: number; end: number };
    lifeIds: string[];
    playerIds: string[];
    infectedClasses: string[];
    spawnSpreadSeconds: number;
    controls: number;
    peakSimultaneousPins: number;
    observedSurvivorHealthLoss: number;
    survivorHealthSamples: number;
    /** This is deterministic time-gap clustering, not a claim of player intent. */
    inference: "spawn-gap-v1";
  }>;
  clearStats: Array<{
    playerId: string;
    playerAlias: string;
    deathCorrelatedClears: number;
    responseSeconds: number[];
    medianResponseSeconds: number | null;
  }>;
  tankEncounters: Array<{
    id: string;
    controllerId: string;
    controllerAlias: string;
    tickRange: { start: number; end: number };
    durationSeconds: number;
    healthAtTake: number | null;
    lowestObservedHealth: number | null;
    healthAtEnd: number | null;
    maximumObservedFrustration: number | null;
    punches: number;
    registeredRockThrows: number;
    damageDealt: number | null;
    damageTaken: number | null;
    damageBySurvivor: Array<{
      playerId: string;
      playerAlias: string;
      damage: number;
    }>;
    survivorIncaps: number;
    survivorDeaths: number;
    endReason: "death" | "control-ended" | "demo-end";
  }>;
}

export interface CompetitiveHalfPlayerSummary {
  sampleCount: number;
  durationSeconds: number;
  distanceUnits: number;
  viewTravelDegrees: number;
  observedPositionRate: number;
  observedAnglesRate: number;
  observedTeamRate: number;
  observedClassRate: number;
  observedWeaponRate: number;
  weapons: string[];
  survivorDeaths: number;
  infectedDeaths: number;
  specialInfectedKills: number;
  headshotKills: number;
  checkpointInfectedKills?: number;
  revives?: number;
  survivorIncaps?: number;
  specialIncaps?: number;
  pounces?: number;
  highestPounceDamage?: number;
  longestJockeyRide?: number;
  pinSeconds: number;
  ghostSeconds: number;
  observedHealthLost: number;
  killsByWeapon: Record<string, number>;
  killsByInfectedClass: Record<string, number>;
  infectedClasses: string[];
}

function buildSessionEvidence(
  header: DemoHeader,
  serverInfo: L4d2ServerInfo | null,
  stableTokens: readonly string[],
  pseudonymKey: string | Uint8Array,
): DemoSessionEvidence {
  const mapSequence = /^((?:c|m)[0-9]+)m([0-9]+)/i.exec(header.mapName);
  const serverToken = header.serverName
    ? createHmac("sha256", pseudonymKey)
        .update(`server:${header.serverName}`)
        .digest("hex")
    : null;
  const roster = [...new Set(stableTokens)].sort();
  const rosterToken = roster.length
    ? createHash("sha256").update(roster.join("\n")).digest("hex")
    : null;
  return {
    serverToken,
    rosterToken,
    serverCount: serverInfo?.serverCount ?? null,
    campaign: mapSequence?.[1]?.toLowerCase() ?? null,
    chapter: mapSequence?.[2] ? Number(mapSequence[2]) : null,
    evidence: [
      ...(serverToken ? ["hmac-server-identity-v1"] : []),
      ...(rosterToken ? ["stable-human-roster-v1"] : []),
      ...(serverInfo ? ["source-server-count"] : []),
      ...(mapSequence ? ["campaign-map-sequence"] : []),
    ],
  };
}

export interface PreparedDemoProjection {
  readonly parserVersion: string;
  readonly parser: ParserLineage;
  readonly demoSha256: string;
  readonly bytes: number;
  readonly header: DemoHeader;
  readonly decodeIssues: readonly DecodeIssue[];
  /** Null explicitly means the demo header cannot establish demo time. */
  readonly tickIntervalSeconds: number | null;
  readonly identity: {
    readonly mappings: readonly ProjectableUserInfo[];
    readonly displayIdentities: readonly DisplayUserInfoIdentity[];
    readonly rejectedEntries: number;
  };
  readonly observations: readonly ProjectedPlayerObservation[];
  readonly witchObservations: readonly L4d2WitchObservation[];
  readonly playerEpochs: readonly PlayerEpoch[];
  readonly projectionCoverage: PlayerProjectionCoverage;
  readonly matchStates: readonly L4d2MatchState[];
  /** Null explicitly means svc_ServerInfo was not observed. */
  readonly serverInfo: L4d2ServerInfo | null;
  readonly eventSummary: GameEventTelemetrySummary;
  readonly eventVisits: readonly GameEventVisit[];
  readonly sourcePerspective: DemoSourcePerspective;
  readonly recorderCommands: readonly RecorderCommandObservation[];
  readonly recorderCommandCoverage: RecorderCommandCoverage;
}

export type DemoProjectionProvider = (
  bytes: Uint8Array,
  options: {
    pseudonymKey: string | Uint8Array;
    onProgress?: (value: number, message: string) => void;
  },
) => PreparedDemoProjection | Promise<PreparedDemoProjection>;

export async function buildEvidenceBundle(
  bytes: Uint8Array,
  options: {
    pseudonymKey: string | Uint8Array;
    onProgress?: (value: number, message: string) => void;
    /** Internal replacement seam; omitted by normal synchronous callers. */
    projectionProvider?: DemoProjectionProvider;
  },
): Promise<EvidenceBundle> {
  const provider =
    options.projectionProvider ?? (await defaultProjectionProvider());
  return buildEvidenceBundleFromPrepared(
    await provider(bytes, options),
    options,
  );
}

async function defaultProjectionProvider(): Promise<DemoProjectionProvider> {
  const { prepareNativeDemoProjection } = await import(
    "./native-demo-provider.js"
  );
  return prepareNativeDemoProjection;
}

export function buildEvidenceBundleFromPrepared(
  prepared: PreparedDemoProjection,
  options: {
    pseudonymKey: string | Uint8Array;
    onProgress?: (value: number, message: string) => void;
  },
): EvidenceBundle {
  const progress = (value: number, message: string) =>
    options.onProgress?.(value, message);
  const {
    demoSha256,
    header,
    decodeIssues,
    identity: identityTimeline,
    observations,
    witchObservations,
    playerEpochs: extractedPlayerEpochs,
    matchStates,
    serverInfo,
    eventSummary,
    eventVisits,
    sourcePerspective,
    recorderCommands,
    recorderCommandCoverage,
    parserVersion,
  } = prepared;
  const tickIntervalSeconds = prepared.tickIntervalSeconds ?? undefined;
  progress(0.62, "Correlating player epochs and side swaps");
  const inferredIdentityEpochIds = new Set<string>();
  const playerEpochs = extractedPlayerEpochs.map((epoch) => {
    if (epoch.userId.value !== undefined) return epoch;
    const endTick = epoch.disconnectedAtTick.value ?? header.playbackTicks;
    const timedCandidates = identityTimeline.mappings.filter(
      (identity) =>
        identity.entityIndex === epoch.entitySlot &&
        identity.userId !== undefined &&
        identity.effectiveTick !== undefined &&
        identity.effectiveTick >= epoch.connectedAtTick &&
        identity.effectiveTick <= endTick,
    );
    const slotCandidates = identityTimeline.mappings.filter(
      (identity) =>
        identity.entityIndex === epoch.entitySlot &&
        identity.userId !== undefined,
    );
    const candidates = timedCandidates.length
      ? timedCandidates
      : slotCandidates;
    const identities = new Set(candidates.map((identity) => identity.userId));
    if (identities.size !== 1) return epoch;
    const identity = candidates.at(-1)!;
    const userId = identity.userId!;
    inferredIdentityEpochIds.add(epoch.id);
    return {
      ...epoch,
      userId: { availability: "observed" as const, value: userId },
      steamId:
        identity.stableIdentityToken === undefined
          ? epoch.steamId
          : {
              availability: "observed" as const,
              value: identity.stableIdentityToken,
            },
    };
  });
  progress(0.7, "Running evidence detectors");
  const detected = buildRealAimEvidence({ demoSha256, observations });
  progress(0.78, "Decoding combat and round events");
  const stableTokens = new Map(
    playerEpochs.flatMap((epoch) =>
      epoch.steamId.value === undefined
        ? []
        : ([[epoch.id, epoch.steamId.value]] as const),
    ),
  );
  const session = buildSessionEvidence(
    header,
    serverInfo,
    [...stableTokens.values()],
    options.pseudonymKey,
  );
  progress(0.86, "Deriving scores, timelines, and competitive stats");
  const stats = buildDemoStats(
    header.playbackTimeSeconds,
    header.playbackTicks,
    decodeIssues.length,
    observations,
    detected.artifact.players,
    stableTokens,
    eventSummary,
    eventVisits,
    playerEpochs,
    identityTimeline.displayIdentities,
    matchStates,
    tickIntervalSeconds,
    witchObservations,
    inferredIdentityEpochIds,
    sourcePerspective,
    recorderCommands,
    recorderCommandCoverage,
  );
  progress(0.96, "Packaging evidence and analysis lineage");
  return {
    schemaVersion: 1,
    demo: {
      parser: prepared.parser,
      sha256: demoSha256,
      mapName: header.mapName,
      bytes: prepared.bytes,
      session,
      stats,
    },
    cases: detected.artifact.players
      .filter(
        (player) =>
          player.result.evidence.length > 0 ||
          stableTokens.has(player.playerEpochId),
      )
      .map((player) =>
        toCase(
          player,
          observations,
          header.mapName,
          demoSha256,
          stableTokens.get(player.playerEpochId),
          identityTimeline.rejectedEntries,
          tickIntervalSeconds,
          detected.artifact.observationArtifactSha256,
          detected.evidenceArtifactSha256,
          detected.artifact.configSha256,
          parserVersion,
        ),
      ),
  };
}

function buildDemoStats(
  durationSeconds: number,
  playbackTicks: number,
  decodeIssueCount: number,
  projected: readonly ProjectedPlayerObservation[],
  detected: readonly PlayerRealEvidence[],
  stableTokens: ReadonlyMap<string, string>,
  events: { events: number; requiredEvents: Readonly<Record<string, number>> },
  eventVisits: readonly GameEventVisit[],
  playerEpochs: readonly {
    id: string;
    userId: { availability: string; value?: number };
  }[],
  displayIdentities: readonly DisplayUserInfoIdentity[],
  matchStates: readonly L4d2MatchState[],
  tickIntervalSeconds: number | undefined,
  witchObservations: readonly L4d2WitchObservation[],
  inferredIdentityEpochIds: ReadonlySet<string> = new Set(),
  sourcePerspective: DemoSourcePerspective = "unknown",
  recorderCommands: readonly RecorderCommandObservation[] = [],
  recorderCommandCoverage: RecorderCommandCoverage = {
    availability: "unavailable",
    totalCommands: 0,
    decodedCommands: 0,
    malformedCommands: 0,
    commandGaps: 0,
    firstDemoTick: null,
    lastDemoTick: null,
    recorderPlayerEpochId: {
      availability: "unavailable",
      reason: "recorder command telemetry was not projected",
    },
    unavailableReason: "recorder command telemetry was not projected",
  },
): DemoStats {
  const observations = projected.map(({ observation }) => observation);
  const availableRate = (
    field: "position" | "eyeAngles" | "team" | "playerClass" | "weapon",
  ) =>
    observations.length === 0
      ? 0
      : observations.filter((row) => row[field].value !== undefined).length /
        observations.length;
  const evidenceByPlayer = new Map(
    detected.map((player) => [
      player.playerEpochId,
      player.result.evidence.length,
    ]),
  );
  const userIdByEpoch = new Map(
    playerEpochs.flatMap((epoch) =>
      epoch.userId.value === undefined
        ? []
        : ([[epoch.id, epoch.userId.value]] as const),
    ),
  );
  const aliases = new Map<string, string>();
  const displayIdentityByUserId = new Map(
    displayIdentities.map((identity) => [identity.userId, identity] as const),
  );
  for (const id of new Set(observations.map((row) => row.playerEpochId))) {
    const token = stableTokens.get(id) ?? id;
    const userId = userIdByEpoch.get(id);
    const displayName =
      userId === undefined
        ? undefined
        : displayIdentityByUserId.get(userId)?.displayName;
    aliases.set(
      id,
      displayName ||
        `Player ${createHash("sha256").update(token).digest("hex").slice(0, 6).toUpperCase()}`,
    );
  }
  const epochByUserId = new Map<number, string>();
  for (const [epoch, userId] of userIdByEpoch) epochByUserId.set(userId, epoch);
  const aliasForUserId = (userId: unknown) =>
    typeof userId === "number"
      ? aliases.get(epochByUserId.get(userId) ?? "")
      : undefined;
  const specialClasses = new Set([
    "Smoker",
    "Boomer",
    "Hunter",
    "Spitter",
    "Jockey",
    "Charger",
    "Tank",
  ]);
  const deaths = eventVisits.filter(
    ({ event }) => event.name === "player_death",
  );
  const increment = (target: Record<string, number>, key: string) => {
    target[key] = (target[key] ?? 0) + 1;
  };
  const maxScalar = (
    rows: readonly ProjectedPlayerObservation[],
    field: keyof ProjectedPlayerObservation["l4d2"],
  ) =>
    (() => {
      const values = rows.flatMap((row) =>
        typeof row.l4d2[field] === "number" ? [row.l4d2[field] as number] : [],
      );
      return values.length ? Math.max(...values) : undefined;
    })();
  const fakeUserIds = new Set(
    displayIdentities
      .filter((identity) => identity.fakePlayer)
      .map((identity) => identity.userId),
  );
  const participantIds = new Set(
    observations
      .filter((row) => {
        if (row.team.value !== 2 && row.team.value !== 3) return false;
        const userId = userIdByEpoch.get(row.playerEpochId);
        return userId === undefined || !fakeUserIds.has(userId);
      })
      .map((row) => row.playerEpochId),
  );
  const participantUserIds = new Set(
    [...participantIds].flatMap((id) => {
      const userId = userIdByEpoch.get(id);
      return userId === undefined ? [] : [userId];
    }),
  );
  const participantSteamIds = new Set(
    displayIdentities.flatMap((identity) =>
      participantUserIds.has(identity.userId) && identity.steamId64
        ? [identity.steamId64]
        : [],
    ),
  );
  const spectators = [
    ...new Map(
      displayIdentities
        .filter(
          (identity) =>
            !identity.fakePlayer &&
            !participantUserIds.has(identity.userId) &&
            (!identity.steamId64 ||
              !participantSteamIds.has(identity.steamId64)),
        )
        .map((identity) => {
          const key = identity.steamId64 ?? `userid:${identity.userId}`;
          return [
            key,
            {
              displayName: identity.displayName,
              ...(identity.steamId64
                ? {
                    steamId64: identity.steamId64,
                    steamProfileUrl: `https://steamcommunity.com/profiles/${identity.steamId64}`,
                  }
                : {}),
            },
          ] as const;
        }),
    ).values(),
  ].sort((left, right) => left.displayName.localeCompare(right.displayName));
  const players = [...participantIds].sort().map((id) => {
    const projectedRows = projected.filter(
      ({ observation }) => observation.playerEpochId === id,
    );
    const rows = observations.filter((row) => row.playerEpochId === id);
    const positions = rows.flatMap((row) =>
      row.position.value === undefined ? [] : [row.position.value],
    );
    const angles = rows.flatMap((row) =>
      row.eyeAngles.value === undefined ? [] : [row.eyeAngles.value],
    );
    const times = rows.flatMap((row) =>
      row.demoTimeSeconds.value === undefined
        ? []
        : [row.demoTimeSeconds.value],
    );
    const distanceUnits = positions.slice(1).reduce((sum, point, index) => {
      const previous = positions[index]!;
      return (
        sum +
        Math.hypot(
          point.x - previous.x,
          point.y - previous.y,
          point.z - previous.z,
        )
      );
    }, 0);
    const viewTravelDegrees = angles.slice(1).reduce((sum, angle, index) => {
      const previous = angles[index]!;
      const yaw = Math.abs(
        ((((angle.yaw - previous.yaw + 180) % 360) + 360) % 360) - 180,
      );
      return sum + Math.hypot(angle.pitch - previous.pitch, yaw);
    }, 0);
    const dominant = <T>(values: T[]): T | null => {
      const counts = new Map<T, number>();
      for (const value of values)
        counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const userId = userIdByEpoch.get(id);
    const playerDeaths = deaths.filter(
      ({ event }) => event.fields.userid === userId,
    );
    const playerKills = deaths.filter(
      ({ event }) => event.fields.attacker === userId,
    );
    const killsByWeapon: Record<string, number> = {};
    const killsByInfectedClass: Record<string, number> = {};
    for (const { event } of playerKills) {
      const weapon = event.fields.weapon;
      const victim = event.fields.victimname;
      if (typeof weapon === "string" && weapon)
        increment(killsByWeapon, weapon);
      if (typeof victim === "string" && specialClasses.has(victim))
        increment(killsByInfectedClass, victim);
    }
    const checkpointInfectedKillSamples = projectedRows.flatMap((row) =>
      row.l4d2.checkpointZombieKills === undefined
        ? []
        : [
            row.l4d2.checkpointZombieKills.reduce(
              (sum, value) => sum + value,
              0,
            ),
          ],
    );
    const checkpointInfectedKills = checkpointInfectedKillSamples.length
      ? Math.max(...checkpointInfectedKillSamples)
      : undefined;
    let pinSeconds = 0;
    let ghostSeconds = 0;
    let observedHealthLost = 0;
    for (let index = 1; index < projectedRows.length; index += 1) {
      const previous = projectedRows[index - 1]!;
      const current = projectedRows[index]!;
      const beforeTime = previous.observation.demoTimeSeconds.value;
      const time = current.observation.demoTimeSeconds.value;
      const delta =
        beforeTime === undefined || time === undefined
          ? 0
          : Math.max(0, Math.min(time - beforeTime, 0.25));
      if (
        previous.l4d2.tongueVictim !== undefined ||
        previous.l4d2.pounceVictim !== undefined ||
        previous.l4d2.jockeyVictim !== undefined ||
        previous.l4d2.carryVictim !== undefined ||
        previous.l4d2.pummelVictim !== undefined
      )
        pinSeconds += delta;
      if (previous.l4d2.ghost) ghostSeconds += delta;
      const beforeHealth = previous.l4d2.health;
      const health = current.l4d2.health;
      if (
        beforeHealth !== undefined &&
        health !== undefined &&
        beforeHealth > health &&
        previous.observation.team.value === 2 &&
        current.observation.team.value === 2 &&
        delta < 0.25
      )
        observedHealthLost += beforeHealth - health;
    }
    return {
      id,
      alias: aliases.get(id)!,
      identity: (() => {
        const userId = userIdByEpoch.get(id);
        const identity =
          userId === undefined
            ? undefined
            : displayIdentityByUserId.get(userId);
        if (!identity) return null;
        return {
          displayName: identity.displayName,
          inference: inferredIdentityEpochIds.has(id)
            ? ("unique-slot-v1" as const)
            : ("observed" as const),
          ...(identity.steamId64
            ? {
                steamId64: identity.steamId64,
                steamProfileUrl: `https://steamcommunity.com/profiles/${identity.steamId64}`,
              }
            : {}),
        };
      })(),
      team: dominant(
        rows.flatMap((row) =>
          row.team.value === undefined ? [] : [row.team.value],
        ),
      ),
      playerClass: dominant(
        rows.flatMap((row) =>
          row.playerClass.value === undefined ? [] : [row.playerClass.value],
        ),
      ),
      sampleCount: rows.length,
      durationSeconds:
        times.length > 1 ? Math.max(...times) - Math.min(...times) : 0,
      distanceUnits,
      viewTravelDegrees,
      observedPositionRate: rows.length ? positions.length / rows.length : 0,
      observedAnglesRate: rows.length ? angles.length / rows.length : 0,
      weapons: [
        ...new Set(
          rows.flatMap((row) =>
            row.weapon.value === undefined ? [] : [row.weapon.value],
          ),
        ),
      ].sort(),
      evidenceWindows: evidenceByPlayer.get(id) ?? 0,
      survivorDeaths: playerDeaths.filter(
        ({ event }) => event.fields.victimname === "",
      ).length,
      infectedDeaths: playerDeaths.filter(
        ({ event }) =>
          typeof event.fields.victimname === "string" &&
          specialClasses.has(event.fields.victimname),
      ).length,
      specialInfectedKills: playerKills.filter(
        ({ event }) =>
          typeof event.fields.victimname === "string" &&
          specialClasses.has(event.fields.victimname),
      ).length,
      headshotKills: playerKills.filter(
        ({ event }) => event.fields.headshot === true,
      ).length,
      checkpointInfectedKills,
      revives: maxScalar(projectedRows, "checkpointRevives"),
      survivorIncaps: maxScalar(projectedRows, "checkpointIncaps"),
      specialIncaps: maxScalar(projectedRows, "checkpointSpecialIncaps"),
      pounces: maxScalar(projectedRows, "checkpointPounces"),
      highestPounceDamage: maxScalar(projectedRows, "highestPounceDamage"),
      longestJockeyRide: maxScalar(projectedRows, "longestJockeyRide"),
      pinSeconds,
      ghostSeconds,
      observedHealthLost,
      killsByWeapon,
      killsByInfectedClass,
      playedSurvivor: rows.some((row) => row.team.value === 2),
      playedInfected: rows.some((row) => row.team.value === 3),
      infectedClasses: [
        ...new Set(
          rows.flatMap((row) =>
            row.playerClass.value === undefined ||
            row.playerClass.value === "Survivor"
              ? []
              : [row.playerClass.value],
          ),
        ),
      ].sort(),
      counters: Object.fromEntries(
        l4d2CounterNames.flatMap((name) => {
          const values = projectedRows.flatMap((row) => {
            const value = row.l4d2.counters?.[name];
            return value === undefined ? [] : [value];
          });
          return values.length ? [[name, Math.max(...values)]] : [];
        }),
      ),
    };
  });
  const specialKillsByClass: Record<string, number> = {};
  const killsByWeapon: Record<string, number> = {};
  for (const { event } of deaths) {
    const victim = event.fields.victimname;
    const weapon = event.fields.weapon;
    if (typeof victim === "string" && specialClasses.has(victim))
      increment(specialKillsByClass, victim);
    if (typeof weapon === "string" && weapon) increment(killsByWeapon, weapon);
  }
  const timeline = eventVisits.flatMap<DemoStats["timeline"][number]>(
    ({ demoTick, event }) => {
      const timeSeconds =
        tickIntervalSeconds === undefined ? 0 : demoTick * tickIntervalSeconds;
      if (event.name === "player_death") {
        const victimClass =
          typeof event.fields.victimname === "string" && event.fields.victimname
            ? event.fields.victimname
            : undefined;
        const actor = aliasForUserId(event.fields.attacker);
        const victim = aliasForUserId(event.fields.userid);
        const actorPlayerId =
          typeof event.fields.attacker === "number"
            ? epochByUserId.get(event.fields.attacker)
            : undefined;
        const victimPlayerId =
          typeof event.fields.userid === "number"
            ? epochByUserId.get(event.fields.userid)
            : undefined;
        const weapon =
          typeof event.fields.weapon === "string"
            ? event.fields.weapon
            : undefined;
        const position =
          typeof event.fields.victim_x === "number" &&
          typeof event.fields.victim_y === "number" &&
          typeof event.fields.victim_z === "number"
            ? {
                x: event.fields.victim_x,
                y: event.fields.victim_y,
                z: event.fields.victim_z,
              }
            : undefined;
        return [
          {
            tick: demoTick,
            timeSeconds,
            type: "death" as const,
            ...(actor ? { actor } : {}),
            ...(actorPlayerId ? { actorPlayerId } : {}),
            ...(victim ? { victim } : {}),
            ...(victimPlayerId ? { victimPlayerId } : {}),
            ...(weapon ? { weapon } : {}),
            ...(victimClass ? { infectedClass: victimClass } : {}),
            headshot: event.fields.headshot === true,
            detail: victimClass
              ? `${actor ?? "Environment"} killed ${victimClass}${weapon ? ` with ${weapon}` : ""}`
              : `${victim ?? "A survivor"} died${weapon ? ` to ${weapon}` : ""}`,
            ...(position ? { position } : {}),
          },
        ];
      }
      if (event.name === "player_hurt_concise") {
        const victim = aliasForUserId(event.fields.userid);
        const victimPlayerId =
          typeof event.fields.userid === "number"
            ? epochByUserId.get(event.fields.userid)
            : undefined;
        const damage =
          typeof event.fields.dmg_health === "number"
            ? event.fields.dmg_health
            : undefined;
        const damageType =
          typeof event.fields.type === "number" ? event.fields.type : undefined;
        const attackerEntityIndex =
          typeof event.fields.attackerentid === "number"
            ? event.fields.attackerentid
            : undefined;
        return [
          {
            tick: demoTick,
            timeSeconds,
            type: "damage" as const,
            evidenceClass: "gameplay-outcome" as const,
            ...(victim ? { victim } : {}),
            ...(victimPlayerId ? { victimPlayerId } : {}),
            ...(damage === undefined ? {} : { damage }),
            ...(damageType === undefined ? {} : { damageType }),
            ...(attackerEntityIndex === undefined
              ? {}
              : { attackerEntityIndex }),
            detail: `${victim ?? "A player"} took ${damage === undefined ? "unknown" : String(damage)} concise-event damage${attackerEntityIndex === undefined ? "" : ` from entity ${attackerEntityIndex}`}`,
          },
        ];
      }
      if (event.name === "round_start" || event.name === "round_end")
        return [
          {
            tick: demoTick,
            timeSeconds,
            type: event.name as "round_start" | "round_end",
            detail:
              event.name === "round_start" ? "Round started" : "Round ended",
          },
        ];
      if (event.name === "player_team") {
        const subject = aliasForUserId(event.fields.userid);
        const subjectPlayerId =
          typeof event.fields.userid === "number"
            ? epochByUserId.get(event.fields.userid)
            : undefined;
        if (!subject) return [];
        return [
          {
            tick: demoTick,
            timeSeconds,
            type: "team_change" as const,
            subject,
            ...(subjectPlayerId ? { subjectPlayerId } : {}),
            detail: `${subject} moved to team ${String(event.fields.team)}`,
          },
        ];
      }
      return [];
    },
  );
  const aliasAtTickEntity = new Map<string, string>();
  const idAtTickEntity = new Map<string, string>();
  for (const row of projected) {
    const alias = aliases.get(row.observation.playerEpochId);
    if (alias)
      aliasAtTickEntity.set(
        `${row.observation.tick}:${row.l4d2.entityIndex}`,
        alias,
      );
    idAtTickEntity.set(
      `${row.observation.tick}:${row.l4d2.entityIndex}`,
      row.observation.playerEpochId,
    );
  }
  const stateTimeline: DemoStats["timeline"] = [];
  const deathTimeline = timeline.filter((event) => event.type === "death");
  const pinFields = [
    ["tongueVictim", "Smoker tongue"],
    ["pounceVictim", "Hunter pounce"],
    ["jockeyVictim", "Jockey ride"],
    ["carryVictim", "Charger carry"],
    ["pummelVictim", "Charger pummel"],
  ] as const;
  const attackCounters = [
    ["m_checkpointPZVomited", "vomit landed"],
    ["m_checkpointPZTankPunches", "Tank punch landed"],
    ["m_checkpointPZTankThrows", "Tank rock throw registered"],
    ["m_checkpointPZPulled", "Smoker pull registered"],
    ["m_checkpointPZNumChargeVictims", "Charger victim registered"],
  ] as const;
  for (const id of participantIds) {
    const rows = projected.filter(
      ({ observation }) => observation.playerEpochId === id,
    );
    const alias = aliases.get(id)!;
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1]!;
      const current = rows[index]!;
      const tick = current.observation.tick;
      const timeSeconds =
        tickIntervalSeconds === undefined ? 0 : tick * tickIntervalSeconds;
      const playerClass = current.observation.playerClass.value;
      const currentPosition = current.observation.position.value;
      const previousPosition = previous.observation.position.value;
      if (
        previous.observation.playerClass.value !== "Tank" &&
        playerClass === "Tank" &&
        current.observation.team.value === 3 &&
        current.l4d2.ghost !== true
      )
        stateTimeline.push({
          tick,
          timeSeconds,
          type: "tank_control",
          actor: alias,
          actorPlayerId: id,
          infectedClass: "Tank",
          ...(currentPosition ? { position: currentPosition } : {}),
          detail: `${alias} took Tank control`,
        });
      if (
        previous.l4d2.ghost === true &&
        current.l4d2.ghost === false &&
        current.observation.team.value === 3 &&
        playerClass !== "Tank"
      )
        stateTimeline.push({
          tick,
          timeSeconds,
          type: "spawn",
          actor: alias,
          actorPlayerId: id,
          ...(playerClass ? { infectedClass: playerClass } : {}),
          ...(currentPosition ? { position: currentPosition } : {}),
          detail: `${alias} spawned as ${playerClass ?? "Special Infected"}`,
        });
      for (const [counter, label] of attackCounters) {
        const before = previous.l4d2.counters?.[counter];
        const after = current.l4d2.counters?.[counter];
        if (before === undefined || after === undefined) continue;
        const delta = after - before;
        if (delta <= 0) continue;
        stateTimeline.push({
          tick,
          timeSeconds,
          type: "attack",
          actor: alias,
          actorPlayerId: id,
          ...(playerClass ? { infectedClass: playerClass } : {}),
          ...(currentPosition ? { position: currentPosition } : {}),
          detail: `${alias}: ${label}${delta > 1 ? ` ×${delta}` : ""}`,
        });
      }
      if (
        previous.l4d2.incapacitated !== true &&
        current.l4d2.incapacitated === true &&
        current.observation.team.value === 2
      )
        stateTimeline.push({
          tick,
          timeSeconds,
          type: "incap",
          victim: alias,
          victimPlayerId: id,
          ...(currentPosition ? { position: currentPosition } : {}),
          detail: `${alias} was incapacitated`,
        });
      if (
        current.l4d2.checkpointRevives !== undefined &&
        previous.l4d2.checkpointRevives !== undefined &&
        current.l4d2.checkpointRevives > previous.l4d2.checkpointRevives
      )
        stateTimeline.push({
          tick,
          timeSeconds,
          type: "revive",
          actor: alias,
          actorPlayerId: id,
          ...(currentPosition ? { position: currentPosition } : {}),
          detail: `${alias} completed a revive`,
        });
      for (const [field, label] of pinFields) {
        const before = previous.l4d2[field];
        const victimEntity = current.l4d2[field];
        if (before === victimEntity) continue;
        if (victimEntity !== undefined) {
          const victim = aliasAtTickEntity.get(`${tick}:${victimEntity}`);
          const victimPlayerId = idAtTickEntity.get(`${tick}:${victimEntity}`);
          stateTimeline.push({
            tick,
            timeSeconds,
            type: "pin_start",
            actor: alias,
            actorPlayerId: id,
            ...(victim ? { victim } : {}),
            ...(victimPlayerId ? { victimPlayerId } : {}),
            ...(playerClass ? { infectedClass: playerClass } : {}),
            ...(currentPosition ? { position: currentPosition } : {}),
            detail: `${alias} started a ${label}${victim ? ` on ${victim}` : ""}`,
          });
        } else if (before !== undefined) {
          const victim = aliasAtTickEntity.get(
            `${previous.observation.tick}:${before}`,
          );
          const victimPlayerId = idAtTickEntity.get(
            `${previous.observation.tick}:${before}`,
          );
          stateTimeline.push({
            tick,
            timeSeconds,
            type: "pin_end",
            actor: alias,
            actorPlayerId: id,
            ...(playerClass ? { infectedClass: playerClass } : {}),
            ...(victim ? { victim } : {}),
            ...(victimPlayerId ? { victimPlayerId } : {}),
            ...(previousPosition ? { position: previousPosition } : {}),
            detail: `${alias}'s ${label} ended${victim ? ` on ${victim}` : ""}`,
          });
          const remainsControlled = pinFields.some(
            ([otherField]) => current.l4d2[otherField] === before,
          );
          const maximumTickGap =
            tickIntervalSeconds === undefined
              ? 0
              : Math.ceil(0.5 / tickIntervalSeconds);
          const killingDeath = deathTimeline.find(
            (event) =>
              event.victim === alias &&
              event.actor !== undefined &&
              Math.abs(event.tick - tick) <= maximumTickGap,
          );
          const clearer = killingDeath?.actor;
          if (clearer && victim && !remainsControlled)
            stateTimeline.push({
              tick,
              timeSeconds,
              type: "clear",
              actor: clearer,
              ...(killingDeath?.actorPlayerId
                ? { actorPlayerId: killingDeath.actorPlayerId }
                : {}),
              victim,
              ...(victimPlayerId ? { victimPlayerId } : {}),
              ...(playerClass ? { infectedClass: playerClass } : {}),
              ...(previousPosition ? { position: previousPosition } : {}),
              detail: `${clearer} cleared ${victim} from a ${label}`,
            });
        }
      }
    }
  }
  const witchEncounters: DemoStats["witchEncounters"] = [];
  const witchGroups = new Map<string, L4d2WitchObservation[]>();
  for (const observation of witchObservations) {
    const key = `${observation.entityIndex}:${observation.lifetime}`;
    const rows = witchGroups.get(key) ?? [];
    rows.push(observation);
    witchGroups.set(key, rows);
  }
  const witchDeaths = deathTimeline.filter(
    (event) => event.infectedClass === "Witch" || event.victim === "Witch",
  );
  const witchDeathGap =
    tickIntervalSeconds === undefined
      ? 0
      : Math.max(1, Math.ceil(2 / tickIntervalSeconds));
  for (const [key, unsorted] of [...witchGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const rows = [...unsorted].sort((left, right) => left.tick - right.tick);
    const first = rows[0]!;
    const last = rows.at(-1)!;
    const enraged = rows.find((row) => (row.rage ?? 0) >= 1);
    const burning = rows.find((row) => row.burning === true);
    const death = witchDeaths.find(
      (event) => Math.abs(event.tick - last.tick) <= witchDeathGap,
    );
    const encounter: DemoStats["witchEncounters"][number] = {
      id: `witch-${key}`,
      entityIndex: first.entityIndex,
      tickRange: { start: first.tick, end: last.tick },
      timeRange: {
        start: first.timeSeconds ?? null,
        end: last.timeSeconds ?? null,
      },
      enragedTick: enraged?.tick ?? null,
      burningTick: burning?.tick ?? null,
      peakRage: rows.some((row) => row.rage !== undefined)
        ? Math.max(...rows.flatMap((row) => row.rage ?? []))
        : null,
      peakWanderRage: rows.some((row) => row.wanderRage !== undefined)
        ? Math.max(...rows.flatMap((row) => row.wanderRage ?? []))
        : null,
      sampleCount: rows.length,
      endReason: death ? "death-correlated" : "despawn-or-demo-end",
    };
    witchEncounters.push(encounter);
    stateTimeline.push({
      tick: first.tick,
      timeSeconds: first.timeSeconds ?? 0,
      type: "witch_spawn",
      infectedClass: "Witch",
      detail: "Witch entity became observable",
    });
    if (enraged)
      stateTimeline.push({
        tick: enraged.tick,
        timeSeconds: enraged.timeSeconds ?? 0,
        type: "witch_enrage",
        infectedClass: "Witch",
        detail: "Witch network rage reached the enraged threshold",
      });
    if (burning)
      stateTimeline.push({
        tick: burning.tick,
        timeSeconds: burning.timeSeconds ?? 0,
        type: "witch_burn",
        infectedClass: "Witch",
        detail: "Witch became observably burning",
      });
    stateTimeline.push({
      tick: last.tick,
      timeSeconds: last.timeSeconds ?? 0,
      type: "witch_end",
      infectedClass: "Witch",
      detail: death
        ? "Witch entity ended near a Witch death event"
        : "Witch entity stopped being observable",
    });
  }
  timeline.push(...stateTimeline);
  timeline.sort(
    (left, right) =>
      left.timeSeconds - right.timeSeconds || left.tick - right.tick,
  );
  const finalMatchState = matchStates.at(-1);
  const competitive = deriveCompetitiveStats({
    projected: projected.filter((row) =>
      participantIds.has(row.observation.playerEpochId),
    ),
    matchStates,
    timeline: timeline.filter(
      (event) =>
        (!event.actorPlayerId || participantIds.has(event.actorPlayerId)) &&
        (!event.victimPlayerId || participantIds.has(event.victimPlayerId)) &&
        (!event.subjectPlayerId || participantIds.has(event.subjectPlayerId)),
    ),
    aliases,
    playbackTicks,
    tickIntervalSeconds,
  });
  const survivorHealthTraces = deriveSurvivorHealthTraces({
    projected,
    participantIds,
    aliases,
    tickIntervalSeconds,
  });
  return {
    sourcePerspective,
    evidenceSemantics: {
      recorderCommands: "client-command-intent",
      playerState: "server-observed-state",
      gameEvents: "gameplay-outcome",
    },
    recorderCommandEvidence: deriveRecorderCommandEvidence(
      recorderCommands,
      recorderCommandCoverage,
    ),
    durationSeconds,
    playbackTicks,
    tickRate: durationSeconds > 0 ? playbackTicks / durationSeconds : null,
    playerCount: players.length,
    observationCount: observations.length,
    eventCount: events.events,
    requiredEvents: { ...events.requiredEvents },
    decodeIssueCount,
    availability: {
      position: availableRate("position"),
      eyeAngles: availableRate("eyeAngles"),
      team: availableRate("team"),
      playerClass: availableRate("playerClass"),
      weapon: availableRate("weapon"),
    },
    match: {
      roundStarts: eventVisits.filter(
        ({ event }) => event.name === "round_start",
      ).length,
      roundEnds: eventVisits.filter(({ event }) => event.name === "round_end")
        .length,
      survivorDeaths: deaths.filter(
        ({ event }) => event.fields.victimname === "",
      ).length,
      specialInfectedDeaths: deaths.filter(
        ({ event }) =>
          typeof event.fields.victimname === "string" &&
          specialClasses.has(event.fields.victimname),
      ).length,
      tankDeaths: deaths.filter(
        ({ event }) => event.fields.victimname === "Tank",
      ).length,
      witchDeaths: deaths.filter(
        ({ event }) => event.fields.victimname === "Witch",
      ).length,
      specialKillsByClass,
      killsByWeapon,
      campaignScores: [...(finalMatchState?.campaignScores ?? [])],
      chapterScores: [...(finalMatchState?.chapterScores ?? [])],
      survivorScores: [...(finalMatchState?.survivorScores ?? [])],
      survivorDistances: [...(finalMatchState?.survivorDistances ?? [])],
      survivorDeathDistances: [
        ...(finalMatchState?.survivorDeathDistances ?? []),
      ],
      roundDurations: [...(finalMatchState?.roundDurations ?? [])],
      roundNumber: finalMatchState?.roundNumber ?? null,
      teamsFlipped: finalMatchState?.teamsFlipped ?? null,
      secondHalf: finalMatchState?.secondHalf ?? null,
      scoreTimeline: matchStates.map((state) => ({
        tick: state.tick,
        timeSeconds:
          tickIntervalSeconds === undefined
            ? 0
            : state.tick * tickIntervalSeconds,
        campaignScores: [...state.campaignScores],
        chapterScores: [...state.chapterScores],
        survivorScores: [...state.survivorScores],
        survivorDistances: [...state.survivorDistances],
        teamsFlipped: state.teamsFlipped ?? null,
        secondHalf: state.secondHalf ?? null,
        voteRestarting: state.voteRestarting ?? null,
        roundSetupTimeRemaining: state.roundSetupTimeRemaining ?? null,
      })),
    },
    timeline,
    competitive,
    witchEncounters,
    survivorHealthTraces,
    survivorLoadoutTraces: deriveSurvivorLoadoutTraces({
      projected,
      participantIds,
      aliases,
      tickIntervalSeconds,
    }),
    survivorAmmoTraces: deriveSurvivorAmmoTraces({
      projected,
      participantIds,
      aliases,
      tickIntervalSeconds,
    }),
    spectators,
    players,
  };
}

const recorderButtons = {
  attack: 1 << 0,
  jump: 1 << 1,
  duck: 1 << 2,
  use: 1 << 5,
  secondaryAttack: 1 << 11,
  reload: 1 << 13,
} as const;

export function deriveRecorderCommandEvidence(
  commands: readonly RecorderCommandObservation[],
  coverage: RecorderCommandCoverage,
): RecorderCommandEvidence {
  const heldCommandCounts = {
    attack: 0,
    secondaryAttack: 0,
    reload: 0,
    jump: 0,
    duck: 0,
    use: 0,
  };
  const pressCounts = { ...heldCommandCounts };
  let previous: RecorderCommandObservation | undefined;
  let intendedMovementCommands = 0;
  let nonzeroMouseDeltaCommands = 0;
  for (const command of commands) {
    if (
      command.intendedMovement.forward !== 0 ||
      command.intendedMovement.side !== 0 ||
      command.intendedMovement.up !== 0
    )
      intendedMovementCommands += 1;
    if (command.mouseDelta.x !== 0 || command.mouseDelta.y !== 0)
      nonzeroMouseDeltaCommands += 1;
    const contiguous =
      previous !== undefined &&
      command.commandNumber === previous.commandNumber + 1;
    for (const [name, mask] of Object.entries(recorderButtons) as Array<
      [keyof typeof recorderButtons, number]
    >) {
      const held = (command.buttons & mask) !== 0;
      if (held) heldCommandCounts[name] += 1;
      if (held && (!contiguous || (previous!.buttons & mask) === 0))
        pressCounts[name] += 1;
    }
    previous = command;
  }
  const identity = coverage.recorderPlayerEpochId;
  return {
    availability: coverage.availability,
    scope: "recorder-only",
    semantics: "client-command-intent",
    totalCommands: coverage.totalCommands,
    decodedCommands: coverage.decodedCommands,
    malformedCommands: coverage.malformedCommands,
    commandGaps: coverage.commandGaps,
    demoTickRange:
      coverage.firstDemoTick === null || coverage.lastDemoTick === null
        ? null
        : { start: coverage.firstDemoTick, end: coverage.lastDemoTick },
    recorderPlayerEpochId: identity.value ?? null,
    recorderIdentityAvailability: identity.availability,
    heldCommandCounts,
    pressCounts,
    intendedMovementCommands,
    nonzeroMouseDeltaCommands,
    limitations: [
      "Recorder-only client command intent; it is not authoritative movement or an outcome.",
      "Attack input is not a fired shot and cannot supply a hit/miss accuracy denominator.",
      "Mouse deltas are command-generation values, not guaranteed raw physical-device motion.",
      ...(coverage.unavailableReason ? [coverage.unavailableReason] : []),
    ],
  };
}

export function deriveSurvivorAmmoTraces(input: {
  projected: readonly ProjectedPlayerObservation[];
  participantIds: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  tickIntervalSeconds: number | undefined;
}): SurvivorAmmoTrace[] {
  const result: SurvivorAmmoTrace[] = [];
  for (const playerId of [...input.participantIds].sort()) {
    const rows = input.projected.filter(
      (row) =>
        row.observation.playerEpochId === playerId &&
        row.observation.team.value === 2,
    );
    const observed = rows.filter(
      (row) =>
        row.l4d2.activeWeaponAmmo?.clip !== undefined ||
        row.l4d2.activeWeaponAmmo?.reserve !== undefined,
    );
    if (!observed.length) continue;
    const points: SurvivorAmmoTrace["points"] = [];
    let priorSecond = -1;
    let priorStructure = "";
    for (const row of observed) {
      const ammo = row.l4d2.activeWeaponAmmo!;
      const timeSeconds =
        row.observation.demoTimeSeconds.value ??
        (input.tickIntervalSeconds === undefined
          ? 0
          : row.observation.tick * input.tickIntervalSeconds);
      const second = Math.floor(timeSeconds);
      const structure = JSON.stringify([
        ammo.weaponClass,
        ammo.reloading,
        ammo.primaryAmmoType,
      ]);
      const point: SurvivorAmmoTrace["points"][number] = {
        tick: row.observation.tick,
        timeSeconds,
        ...(ammo.weaponClass === undefined
          ? {}
          : { weaponClass: ammo.weaponClass }),
        ...(ammo.clip === undefined ? {} : { clip: ammo.clip }),
        ...(ammo.reserve === undefined ? {} : { reserve: ammo.reserve }),
        ...(ammo.reloading === undefined ? {} : { reloading: ammo.reloading }),
        ...(ammo.extraPrimaryAmmo === undefined
          ? {}
          : { extraPrimaryAmmo: ammo.extraPrimaryAmmo }),
        ...(ammo.upgradedAmmoLoaded === undefined
          ? {}
          : { upgradedAmmoLoaded: ammo.upgradedAmmoLoaded }),
      };
      if (second === priorSecond && structure === priorStructure)
        points[points.length - 1] = point;
      else points.push(point);
      priorSecond = second;
      priorStructure = structure;
    }
    result.push({
      playerId,
      playerAlias: input.aliases.get(playerId) ?? playerId.slice(0, 8),
      sourceSamples: rows.length,
      coverage: rows.length ? observed.length / rows.length : 0,
      points,
    });
  }
  return result;
}

export function deriveSurvivorLoadoutTraces(input: {
  projected: readonly ProjectedPlayerObservation[];
  participantIds: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  tickIntervalSeconds: number | undefined;
}): SurvivorLoadoutTrace[] {
  const result: SurvivorLoadoutTrace[] = [];
  for (const playerId of [...input.participantIds].sort()) {
    const rows = input.projected.filter(
      (row) =>
        row.observation.playerEpochId === playerId &&
        row.observation.team.value === 2,
    );
    if (!rows.some((row) => row.l4d2.loadout)) continue;
    const observed = {
      primaryWeapon: rows.filter(
        (row) => row.l4d2.loadout?.primaryWeaponId !== undefined,
      ).length,
      firstAid: rows.filter(
        (row) => row.l4d2.loadout?.firstAidSlotId !== undefined,
      ).length,
      temporaryHealth: rows.filter(
        (row) => row.l4d2.loadout?.pillsSlotId !== undefined,
      ).length,
    };
    const points: SurvivorLoadoutTrace["points"] = [];
    let prior = "";
    for (const row of rows) {
      const loadout = row.l4d2.loadout;
      if (!loadout) continue;
      const signature = JSON.stringify([
        loadout.primaryWeaponId,
        loadout.firstAidSlotId,
        loadout.pillsSlotId,
      ]);
      if (signature === prior) continue;
      const item = (id: number | undefined) =>
        id === undefined ? undefined : id === 0 ? null : l4d2WeaponIdentity(id);
      const primaryWeapon = item(loadout.primaryWeaponId);
      const firstAid = item(loadout.firstAidSlotId);
      const temporaryHealth = item(loadout.pillsSlotId);
      points.push({
        tick: row.observation.tick,
        timeSeconds:
          row.observation.demoTimeSeconds.value ??
          (input.tickIntervalSeconds === undefined
            ? 0
            : row.observation.tick * input.tickIntervalSeconds),
        ...(primaryWeapon === undefined ? {} : { primaryWeapon }),
        ...(firstAid === undefined ? {} : { firstAid }),
        ...(temporaryHealth === undefined ? {} : { temporaryHealth }),
      });
      prior = signature;
    }
    result.push({
      playerId,
      playerAlias: input.aliases.get(playerId) ?? playerId.slice(0, 8),
      sourceSamples: rows.length,
      coverage: {
        primaryWeapon: rows.length ? observed.primaryWeapon / rows.length : 0,
        firstAid: rows.length ? observed.firstAid / rows.length : 0,
        temporaryHealth: rows.length
          ? observed.temporaryHealth / rows.length
          : 0,
      },
      points,
    });
  }
  return result;
}

export function deriveSurvivorHealthTraces(input: {
  projected: readonly ProjectedPlayerObservation[];
  participantIds: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  tickIntervalSeconds: number | undefined;
}): DemoStats["survivorHealthTraces"] {
  const traces: DemoStats["survivorHealthTraces"] = [];
  for (const id of [...input.participantIds].sort()) {
    const rows = input.projected
      .filter(
        (row) =>
          row.observation.playerEpochId === id &&
          row.observation.team.value === 2,
      )
      .sort((left, right) => left.observation.tick - right.observation.tick);
    if (!rows.some((row) => row.l4d2.health !== undefined)) continue;
    const points: DemoStats["survivorHealthTraces"][number]["points"] = [];
    let previousMaterial = "";
    let previousSecond = -1;
    for (const row of rows) {
      const health = row.l4d2.health;
      if (health === undefined) continue;
      const timeSeconds =
        row.observation.demoTimeSeconds.value ??
        (input.tickIntervalSeconds === undefined
          ? 0
          : row.observation.tick * input.tickIntervalSeconds);
      const second = Math.floor(timeSeconds);
      const material = JSON.stringify([
        health,
        row.l4d2.maxHealth,
        row.l4d2.incapacitated,
        row.l4d2.lifeState,
      ]);
      if (
        points.length > 0 &&
        material === previousMaterial &&
        second === previousSecond
      )
        continue;
      points.push({
        tick: row.observation.tick,
        timeSeconds,
        health,
        ...(row.l4d2.maxHealth === undefined
          ? {}
          : { maxHealth: row.l4d2.maxHealth }),
        ...(row.l4d2.healthBuffer === undefined
          ? {}
          : { healthBuffer: row.l4d2.healthBuffer }),
        ...(row.l4d2.incapacitated === undefined
          ? {}
          : { incapacitated: row.l4d2.incapacitated }),
        ...(row.l4d2.lifeState === undefined
          ? {}
          : { lifeState: row.l4d2.lifeState }),
      });
      previousMaterial = material;
      previousSecond = second;
    }
    traces.push({
      playerId: id,
      playerAlias: input.aliases.get(id) ?? id.slice(0, 8),
      sourceSamples: rows.length,
      healthCoverage:
        rows.filter((row) => row.l4d2.health !== undefined).length /
        rows.length,
      bufferCoverage:
        rows.filter((row) => row.l4d2.healthBuffer !== undefined).length /
        rows.length,
      points,
    });
  }
  return traces;
}

export function sumPositiveCounterDeltas(
  rows: readonly ProjectedPlayerObservation[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1]!.l4d2.counters ?? {};
    const after = rows[index]!.l4d2.counters ?? {};
    for (const name of l4d2CounterNames) {
      const previous = before[name];
      const current = after[name];
      if (
        previous === undefined ||
        current === undefined ||
        current <= previous
      )
        continue;
      totals[name] = (totals[name] ?? 0) + current - previous;
    }
  }
  return totals;
}

function deriveHalfPlayerSummary(
  rows: readonly ProjectedPlayerObservation[],
  timeline: readonly DemoStats["timeline"][number][],
  playerId: string,
  range: { start: number; end: number },
): CompetitiveHalfPlayerSummary {
  const positions = rows.flatMap((row) =>
    row.observation.position.value === undefined
      ? []
      : [row.observation.position.value],
  );
  const angles = rows.flatMap((row) =>
    row.observation.eyeAngles.value === undefined
      ? []
      : [row.observation.eyeAngles.value],
  );
  const times = rows.flatMap((row) =>
    row.observation.demoTimeSeconds.value === undefined
      ? []
      : [row.observation.demoTimeSeconds.value],
  );
  const distanceUnits = positions.slice(1).reduce((sum, point, index) => {
    const previous = positions[index]!;
    return (
      sum +
      Math.hypot(
        point.x - previous.x,
        point.y - previous.y,
        point.z - previous.z,
      )
    );
  }, 0);
  const viewTravelDegrees = angles.slice(1).reduce((sum, angle, index) => {
    const previous = angles[index]!;
    const yaw = Math.abs(
      ((((angle.yaw - previous.yaw + 180) % 360) + 360) % 360) - 180,
    );
    return sum + Math.hypot(angle.pitch - previous.pitch, yaw);
  }, 0);
  const scopedEvents = timeline.filter(
    (event) => event.tick >= range.start && event.tick <= range.end,
  );
  const playerKills = scopedEvents.filter(
    (event) => event.type === "death" && event.actorPlayerId === playerId,
  );
  const playerDeaths = scopedEvents.filter(
    (event) => event.type === "death" && event.victimPlayerId === playerId,
  );
  const specialNames = new Set([
    "Smoker",
    "Boomer",
    "Hunter",
    "Spitter",
    "Jockey",
    "Charger",
    "Tank",
  ]);
  const recordCounts = (values: readonly (string | undefined)[]) => {
    const result: Record<string, number> = {};
    for (const value of values)
      if (value) result[value] = (result[value] ?? 0) + 1;
    return result;
  };
  const scalarDelta = (field: keyof ProjectedPlayerObservation["l4d2"]) => {
    let total = 0;
    let observed = false;
    for (let index = 1; index < rows.length; index += 1) {
      const before = rows[index - 1]!.l4d2[field];
      const after = rows[index]!.l4d2[field];
      if (typeof before !== "number" || typeof after !== "number") continue;
      observed = true;
      if (after > before) total += after - before;
    }
    return observed ? total : undefined;
  };
  const scalarMaximum = (field: keyof ProjectedPlayerObservation["l4d2"]) => {
    const values = rows.flatMap((row) =>
      typeof row.l4d2[field] === "number" ? [row.l4d2[field] as number] : [],
    );
    return values.length ? Math.max(...values) : undefined;
  };
  let checkpointInfectedKills: number | undefined;
  let pinSeconds = 0;
  let ghostSeconds = 0;
  let observedHealthLost = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    const beforeCommon = previous.l4d2.checkpointZombieKills;
    const afterCommon = current.l4d2.checkpointZombieKills;
    if (beforeCommon && afterCommon) {
      checkpointInfectedKills ??= 0;
      for (
        let slot = 0;
        slot < Math.min(beforeCommon.length, afterCommon.length);
        slot += 1
      )
        if (afterCommon[slot]! > beforeCommon[slot]!)
          checkpointInfectedKills += afterCommon[slot]! - beforeCommon[slot]!;
    }
    const beforeTime = previous.observation.demoTimeSeconds.value;
    const time = current.observation.demoTimeSeconds.value;
    const delta =
      beforeTime === undefined || time === undefined
        ? 0
        : Math.max(0, Math.min(time - beforeTime, 0.25));
    if (
      previous.l4d2.tongueVictim !== undefined ||
      previous.l4d2.pounceVictim !== undefined ||
      previous.l4d2.jockeyVictim !== undefined ||
      previous.l4d2.carryVictim !== undefined ||
      previous.l4d2.pummelVictim !== undefined
    )
      pinSeconds += delta;
    if (previous.l4d2.ghost) ghostSeconds += delta;
    const beforeHealth = previous.l4d2.health;
    const health = current.l4d2.health;
    if (
      beforeHealth !== undefined &&
      health !== undefined &&
      beforeHealth > health &&
      delta < 0.25
    )
      observedHealthLost += beforeHealth - health;
  }
  const optionalDelta = (
    key: keyof CompetitiveHalfPlayerSummary,
    field: keyof ProjectedPlayerObservation["l4d2"],
  ) => {
    const value = scalarDelta(field);
    return value === undefined ? {} : { [key]: value };
  };
  const optionalMaximum = (
    key: keyof CompetitiveHalfPlayerSummary,
    field: keyof ProjectedPlayerObservation["l4d2"],
  ) => {
    const value = scalarMaximum(field);
    return value === undefined ? {} : { [key]: value };
  };
  return {
    sampleCount: rows.length,
    durationSeconds:
      times.length > 1 ? Math.max(...times) - Math.min(...times) : 0,
    distanceUnits,
    viewTravelDegrees,
    observedPositionRate: rows.length ? positions.length / rows.length : 0,
    observedAnglesRate: rows.length ? angles.length / rows.length : 0,
    observedTeamRate: rows.length
      ? rows.filter((row) => row.observation.team.value !== undefined).length /
        rows.length
      : 0,
    observedClassRate: rows.length
      ? rows.filter((row) => row.observation.playerClass.value !== undefined)
          .length / rows.length
      : 0,
    observedWeaponRate: rows.length
      ? rows.filter((row) => row.observation.weapon.value !== undefined)
          .length / rows.length
      : 0,
    weapons: [
      ...new Set(
        rows.flatMap((row) =>
          row.observation.weapon.value === undefined
            ? []
            : [row.observation.weapon.value],
        ),
      ),
    ].sort(),
    survivorDeaths: playerDeaths.filter((event) => !event.infectedClass).length,
    infectedDeaths: playerDeaths.filter((event) =>
      specialNames.has(event.infectedClass ?? ""),
    ).length,
    specialInfectedKills: playerKills.filter((event) =>
      specialNames.has(event.infectedClass ?? ""),
    ).length,
    headshotKills: playerKills.filter((event) => event.headshot).length,
    ...(checkpointInfectedKills === undefined
      ? {}
      : { checkpointInfectedKills }),
    ...optionalDelta("revives", "checkpointRevives"),
    ...optionalDelta("survivorIncaps", "checkpointIncaps"),
    ...optionalDelta("specialIncaps", "checkpointSpecialIncaps"),
    ...optionalDelta("pounces", "checkpointPounces"),
    ...optionalMaximum("highestPounceDamage", "highestPounceDamage"),
    ...optionalMaximum("longestJockeyRide", "longestJockeyRide"),
    pinSeconds,
    ghostSeconds,
    observedHealthLost,
    killsByWeapon: recordCounts(playerKills.map((event) => event.weapon)),
    killsByInfectedClass: recordCounts(
      playerKills.map((event) =>
        specialNames.has(event.infectedClass ?? "")
          ? event.infectedClass
          : undefined,
      ),
    ),
    infectedClasses: [
      ...new Set(
        rows.flatMap((row) => {
          const value = row.observation.playerClass.value;
          return value && value !== "Survivor" ? [value] : [];
        }),
      ),
    ].sort(),
  };
}

export function clusterSpawnWindows<
  T extends { tickRange: { start: number; end: number } },
>(lives: readonly T[], secondsPerTick: number, spawnGapSeconds = 8) {
  if (!Number.isFinite(secondsPerTick) || secondsPerTick <= 0)
    throw new RangeError("secondsPerTick must be positive");
  if (!Number.isFinite(spawnGapSeconds) || spawnGapSeconds <= 0)
    throw new RangeError("spawnGapSeconds must be positive");
  const groups: T[][] = [];
  for (const life of lives) {
    const group = groups.at(-1);
    const anchor = group?.[0];
    if (
      !group ||
      !anchor ||
      (life.tickRange.start - anchor.tickRange.start) * secondsPerTick >
        spawnGapSeconds
    )
      groups.push([life]);
    else group.push(life);
  }
  const windows = groups.map((group) => {
    const start = group[0]!.tickRange.start;
    const lastSpawn = Math.max(...group.map((life) => life.tickRange.start));
    const lastLifeEnd = Math.max(...group.map((life) => life.tickRange.end));
    return {
      group,
      start,
      end: Math.min(
        lastLifeEnd,
        lastSpawn + Math.max(1, Math.round(spawnGapSeconds / secondsPerTick)),
      ),
    };
  });
  return windows.map((window, index) => ({
    ...window,
    end: Math.max(
      window.start,
      Math.min(window.end, (windows[index + 1]?.start ?? Infinity) - 1),
    ),
  }));
}

export function maximumObservedHealthDrawdown(
  samples: readonly {
    tick: number;
    health: number | undefined;
    upright: boolean;
  }[],
  secondsPerTick: number,
) {
  let maximumDrawdown = 0;
  let segmentPeak: number | undefined;
  let previousTick: number | undefined;
  for (const sample of samples) {
    const contiguous =
      previousTick !== undefined &&
      sample.tick > previousTick &&
      (sample.tick - previousTick) * secondsPerTick <= 0.25;
    if (
      !sample.upright ||
      sample.health === undefined ||
      !Number.isFinite(sample.health) ||
      sample.health < 0 ||
      sample.health > 100 ||
      (previousTick !== undefined && !contiguous)
    ) {
      segmentPeak = undefined;
    }
    if (
      sample.upright &&
      sample.health !== undefined &&
      Number.isFinite(sample.health) &&
      sample.health >= 0 &&
      sample.health <= 100
    ) {
      segmentPeak = Math.max(segmentPeak ?? sample.health, sample.health);
      maximumDrawdown = Math.max(maximumDrawdown, segmentPeak - sample.health);
    }
    previousTick = sample.tick;
  }
  return maximumDrawdown;
}

const OPENING_AREA_WINDOW_SECONDS = 8;

export function deriveObservedOpeningAreaV1(input: {
  projected: readonly ProjectedPlayerObservation[];
  timeline: readonly DemoStats["timeline"][number][];
  halfTickRange: { start: number; end: number };
  survivorPlayerIds: readonly string[];
  tickIntervalSeconds: number | undefined;
}): ObservedOpeningArea {
  const derivation = "survivor-opening-area-v1" as const;
  const roundStart = input.timeline.find(
    (event) =>
      event.type === "round_start" &&
      event.tick >= input.halfTickRange.start &&
      event.tick <= input.halfTickRange.end,
  );
  if (!roundStart)
    return {
      availability: "unavailable",
      derivation,
      reason: "round-start-unobserved",
      observedPlayerIds: [],
    };
  const anchor = { kind: "round-start" as const, tick: roundStart.tick };
  if (!input.tickIntervalSeconds || input.tickIntervalSeconds <= 0)
    return {
      availability: "unavailable",
      derivation,
      reason: "tick-rate-unavailable",
      anchor,
      observedPlayerIds: [],
    };
  const end = Math.min(
    input.halfTickRange.end,
    roundStart.tick +
      Math.floor(OPENING_AREA_WINDOW_SECONDS / input.tickIntervalSeconds),
  );
  let lifeStatePartiallyUnavailable = false;
  const samples = [...input.survivorPlayerIds].sort().flatMap((playerId) => {
    const row = input.projected
      .filter((candidate) => {
        const observation = candidate.observation;
        if (observation.playerEpochId !== playerId) return false;
        const position = observation.position.value;
        const lifeState = candidate.l4d2.lifeState;
        return (
          observation.tick >= roundStart.tick &&
          observation.tick <= end &&
          observation.team.value === 2 &&
          position !== undefined &&
          Number.isFinite(position.x) &&
          Number.isFinite(position.y) &&
          Number.isFinite(position.z) &&
          candidate.l4d2.incapacitated !== true &&
          (lifeState === undefined || lifeState === 0)
        );
      })
      .sort((left, right) => left.observation.tick - right.observation.tick)[0];
    if (row?.l4d2.lifeState === undefined) lifeStatePartiallyUnavailable = true;
    const position = row?.observation.position.value;
    return row && position
      ? [
          {
            playerId,
            tick: row.observation.tick,
            position: { ...position },
          },
        ]
      : [];
  });
  if (samples.length < 2)
    return {
      availability: "unavailable",
      derivation,
      reason: "insufficient-survivor-positions",
      anchor,
      observedPlayerIds: samples.map((sample) => sample.playerId),
    };
  const center = samples.reduce(
    (sum, sample) => ({
      x: sum.x + sample.position.x / samples.length,
      y: sum.y + sample.position.y / samples.length,
      z: sum.z + sample.position.z / samples.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const axes = ["x", "y", "z"] as const;
  const bounds = {
    min: Object.fromEntries(
      axes.map((axis) => [
        axis,
        Math.min(...samples.map((sample) => sample.position[axis])),
      ]),
    ) as { x: number; y: number; z: number },
    max: Object.fromEntries(
      axes.map((axis) => [
        axis,
        Math.max(...samples.map((sample) => sample.position[axis])),
      ]),
    ) as { x: number; y: number; z: number },
  };
  return {
    availability: "derived",
    derivation,
    anchor,
    tickRange: {
      start: Math.min(...samples.map((sample) => sample.tick)),
      end: Math.max(...samples.map((sample) => sample.tick)),
    },
    samples,
    center,
    bounds,
    planarRadiusUnits: Math.max(
      ...samples.map((sample) =>
        Math.hypot(sample.position.x - center.x, sample.position.y - center.y),
      ),
    ),
    limitations: [
      "demo-derived-not-map-authored",
      "first-observed-position-per-player",
      ...(lifeStatePartiallyUnavailable
        ? (["life-state-partially-unavailable"] as const)
        : []),
    ],
  };
}

export function deriveCompetitiveStats(input: {
  projected: readonly ProjectedPlayerObservation[];
  matchStates: readonly L4d2MatchState[];
  timeline: readonly DemoStats["timeline"][number][];
  aliases: ReadonlyMap<string, string>;
  playbackTicks: number;
  tickIntervalSeconds: number | undefined;
}): CompetitiveStats {
  const secondsPerTick = input.tickIntervalSeconds ?? 0;
  const playerIds = [
    ...new Set(input.projected.map((row) => row.observation.playerEpochId)),
  ];
  const firstSecondHalfState = input.matchStates.find(
    (state, index, states) =>
      state.secondHalf === true &&
      states.slice(0, index).some((prior) => prior.secondHalf === false),
  );
  const secondStart = firstSecondHalfState?.tick;
  const observedHalf = input.matchStates.find(
    (state) => state.secondHalf !== undefined,
  )?.secondHalf;
  const halfRanges =
    secondStart === undefined
      ? [
          {
            id:
              observedHalf === true
                ? ("second" as const)
                : observedHalf === false
                  ? ("first" as const)
                  : ("unknown" as const),
            secondHalf: observedHalf ?? null,
            start: 0,
            end: input.playbackTicks,
          },
        ]
      : [
          {
            id: "first" as const,
            secondHalf: false,
            start: 0,
            end: Math.max(0, secondStart - 1),
          },
          {
            id: "second" as const,
            secondHalf: true,
            start: secondStart,
            end: input.playbackTicks,
          },
        ];
  const halves: CompetitiveStats["halves"] = halfRanges.map((half) => {
    const scoped = input.projected.filter(
      (row) =>
        row.observation.tick >= half.start && row.observation.tick <= half.end,
    );
    const dominantSide = (id: string): 2 | 3 | undefined => {
      const counts = { 2: 0, 3: 0 };
      for (const row of scoped) {
        if (row.observation.playerEpochId !== id) continue;
        const team = row.observation.team.value;
        if (team === 2 || team === 3) counts[team] += 1;
      }
      if (counts[2] === counts[3]) return undefined;
      return counts[2] > counts[3] ? 2 : 3;
    };
    const survivorPlayerIds = playerIds.filter((id) => dominantSide(id) === 2);
    const infectedPlayerIds = playerIds.filter((id) => dominantSide(id) === 3);
    const playerHalf = (playerId: string, side: "Survivor" | "Infected") => {
      const team = side === "Survivor" ? 2 : 3;
      const rows = scoped.filter(
        (row) =>
          row.observation.playerEpochId === playerId &&
          row.observation.team.value === team,
      );
      return {
        playerId,
        side,
        counterDeltas: sumPositiveCounterDeltas(rows),
        observedCounters: l4d2CounterNames.filter((name) =>
          rows.some((row) => row.l4d2.counters?.[name] !== undefined),
        ),
        summary: deriveHalfPlayerSummary(rows, input.timeline, playerId, {
          start: half.start,
          end: half.end,
        }),
      };
    };
    return {
      id: half.id,
      secondHalf: half.secondHalf,
      tickRange: { start: half.start, end: half.end },
      survivorPlayerIds,
      infectedPlayerIds,
      observedOpeningArea: deriveObservedOpeningAreaV1({
        projected: input.projected,
        timeline: input.timeline,
        halfTickRange: { start: half.start, end: half.end },
        survivorPlayerIds,
        tickIntervalSeconds: input.tickIntervalSeconds,
      }),
      players: [
        ...survivorPlayerIds.map((playerId) =>
          playerHalf(playerId, "Survivor"),
        ),
        ...infectedPlayerIds.map((playerId) =>
          playerHalf(playerId, "Infected"),
        ),
      ],
    };
  });
  const first = halves.find((half) => half.id === "first");
  const second = halves.find((half) => half.id === "second");
  const anchor = first ?? second ?? halves[0];
  const uniqueSorted = (values: readonly string[]) =>
    [...new Set(values)].sort();
  const rosterAIds = uniqueSorted(
    first && second
      ? [...first.survivorPlayerIds, ...second.infectedPlayerIds]
      : (anchor?.survivorPlayerIds ?? []),
  );
  const rosterBIds = uniqueSorted(
    first && second
      ? [...first.infectedPlayerIds, ...second.survivorPlayerIds]
      : (anchor?.infectedPlayerIds ?? []),
  );
  const sideFor = (
    playerIds: readonly string[],
    half: CompetitiveStats["halves"][number],
  ): "Survivor" | "Infected" | "unknown" => {
    const survivors = playerIds.filter((id) =>
      half.survivorPlayerIds.includes(id),
    ).length;
    const infected = playerIds.filter((id) =>
      half.infectedPlayerIds.includes(id),
    ).length;
    if (survivors === infected) return "unknown";
    return survivors > infected ? "Survivor" : "Infected";
  };
  const rosters: CompetitiveStats["rosters"] = [
    { id: "A" as const, playerIds: rosterAIds },
    { id: "B" as const, playerIds: rosterBIds },
  ].map((roster) => ({
    ...roster,
    confidence:
      first &&
      second &&
      roster.playerIds.length === 4 &&
      roster.playerIds.every(
        (id) =>
          first.survivorPlayerIds.includes(id) !==
          second.survivorPlayerIds.includes(id),
      )
        ? ("high" as const)
        : ("provisional" as const),
    inference: "side-swap-v1" as const,
    sides: halves.map((half) => ({
      halfId: half.id,
      side: sideFor(roster.playerIds, half),
    })),
  }));

  const activePin = (row: ProjectedPlayerObservation) =>
    row.l4d2.tongueVictim !== undefined ||
    row.l4d2.pounceVictim !== undefined ||
    row.l4d2.jockeyVictim !== undefined ||
    row.l4d2.carryVictim !== undefined ||
    row.l4d2.pummelVictim !== undefined;
  const infectedLives: CompetitiveStats["infectedLives"] = [];
  for (const playerId of playerIds) {
    const rows = input.projected.filter(
      (row) => row.observation.playerEpochId === playerId,
    );
    let start = -1;
    for (let index = 0; index <= rows.length; index += 1) {
      const row = rows[index];
      const previous = index > 0 ? rows[index - 1] : undefined;
      const active =
        row !== undefined &&
        row.observation.team.value === 3 &&
        row.observation.playerClass.value !== undefined &&
        row.observation.playerClass.value !== "Survivor" &&
        row.l4d2.ghost !== true;
      const sameLife =
        active &&
        previous !== undefined &&
        previous.observation.team.value === 3 &&
        previous.observation.playerClass.value ===
          row.observation.playerClass.value &&
        previous.l4d2.ghost !== true;
      if (active && !sameLife && start < 0) {
        start = index;
        continue;
      }
      if (start < 0 || (active && sameLife)) continue;
      const slice = rows.slice(start, index);
      const first = slice[0]!;
      const last = slice.at(-1)!;
      const infectedClass = first.observation.playerClass.value!;
      const alias = input.aliases.get(playerId) ?? playerId;
      let controls = activePin(first) ? 1 : 0;
      let pinSeconds = 0;
      for (let cursor = 1; cursor < slice.length; cursor += 1) {
        const prior = slice[cursor - 1]!;
        const current = slice[cursor]!;
        if (!activePin(prior) && activePin(current)) controls += 1;
        const beforeTime = prior.observation.demoTimeSeconds.value;
        const time = current.observation.demoTimeSeconds.value;
        if (activePin(prior) && beforeTime !== undefined && time !== undefined)
          pinSeconds += Math.max(0, Math.min(time - beforeTime, 0.25));
      }
      const death = input.timeline.find(
        (event) =>
          event.type === "death" &&
          (event.victimPlayerId === playerId ||
            (event.victimPlayerId === undefined && event.victim === alias)) &&
          Math.abs(event.tick - last.observation.tick) * secondsPerTick <= 0.75,
      );
      const following = rows[index];
      const endTick = following?.observation.tick ?? last.observation.tick;
      const endReason = death
        ? ("death" as const)
        : following === undefined
          ? ("demo-end" as const)
          : following.l4d2.ghost === true
            ? ("ghost" as const)
            : ("team-or-class-change" as const);
      const priorToFirst = start > 0 ? rows[start - 1] : undefined;
      const startReason =
        infectedClass === "Tank"
          ? ("tank-control" as const)
          : priorToFirst?.l4d2.ghost === true
            ? ("spawn" as const)
            : ("already-active" as const);
      infectedLives.push({
        id: `life-${playerId}-${first.observation.tick}`,
        playerId,
        playerAlias: alias,
        infectedClass,
        tickRange: { start: first.observation.tick, end: endTick },
        durationSeconds: Math.max(
          0,
          (endTick - first.observation.tick) * secondsPerTick,
        ),
        startReason,
        endReason,
        controls,
        pinSeconds,
        counterDeltas: sumPositiveCounterDeltas(slice),
      });
      start = active ? index : -1;
    }
  }

  const ordinaryLives = infectedLives
    .filter((life) => life.infectedClass !== "Tank")
    .sort((left, right) => left.tickRange.start - right.tickRange.start);
  // A demo without a trustworthy tick interval cannot support a time-bounded
  // hit. Preserve the SI lives but emit no causal-looking HP estimate.
  const hitWindows =
    secondsPerTick > 0
      ? clusterSpawnWindows(ordinaryLives, secondsPerTick)
      : ([] as ReturnType<
          typeof clusterSpawnWindows<(typeof ordinaryLives)[number]>
        >);
  const hits: CompetitiveStats["hits"] = hitWindows.map(
    ({ group, start, end }, index) => {
      const pinEvents = input.timeline
        .filter(
          (event) =>
            event.tick >= start &&
            event.tick <= end &&
            (event.type === "pin_start" || event.type === "pin_end"),
        )
        .sort(
          (left, right) =>
            left.tick - right.tick || (left.type === "pin_end" ? -1 : 1),
        );
      let pins = 0;
      let peakSimultaneousPins = 0;
      for (const event of pinEvents) {
        pins += event.type === "pin_start" ? 1 : -1;
        pins = Math.max(0, pins);
        peakSimultaneousPins = Math.max(peakSimultaneousPins, pins);
      }
      let observedSurvivorHealthLoss = 0;
      let survivorHealthSamples = 0;
      const survivorRows = new Map<
        string,
        Array<(typeof input.projected)[number]>
      >();
      for (const row of input.projected) {
        if (
          row.observation.tick < start ||
          row.observation.tick > end ||
          row.observation.team.value !== 2 ||
          row.l4d2.health === undefined
        )
          continue;
        const rows = survivorRows.get(row.observation.playerEpochId) ?? [];
        rows.push(row);
        survivorRows.set(row.observation.playerEpochId, rows);
      }
      for (const rows of survivorRows.values()) {
        const rowsByTick = new Map(
          rows.map((row) => [row.observation.tick, row] as const),
        );
        const distinctRows = [...rowsByTick.values()].sort(
          (left, right) => left.observation.tick - right.observation.tick,
        );
        const isUprightHealthState = (row: (typeof distinctRows)[number]) =>
          row.l4d2.health !== undefined &&
          Number.isFinite(row.l4d2.health) &&
          row.l4d2.incapacitated !== true &&
          (row.l4d2.lifeState === undefined || row.l4d2.lifeState === 0);
        survivorHealthSamples +=
          distinctRows.filter(isUprightHealthState).length;
        observedSurvivorHealthLoss += maximumObservedHealthDrawdown(
          distinctRows.map((row) => ({
            tick: row.observation.tick,
            health: row.l4d2.health,
            upright: isUprightHealthState(row),
          })),
          secondsPerTick,
        );
      }
      observedSurvivorHealthLoss = Math.min(400, observedSurvivorHealthLoss);
      return {
        id: `hit-${index + 1}`,
        tickRange: { start, end },
        lifeIds: group.map((life) => life.id),
        playerIds: [...new Set(group.map((life) => life.playerId))],
        infectedClasses: [...new Set(group.map((life) => life.infectedClass))],
        spawnSpreadSeconds:
          (Math.max(...group.map((life) => life.tickRange.start)) - start) *
          secondsPerTick,
        controls: group.reduce((sum, life) => sum + life.controls, 0),
        peakSimultaneousPins,
        observedSurvivorHealthLoss,
        survivorHealthSamples,
        inference: "spawn-gap-v1" as const,
      };
    },
  );

  const idByAlias = new Map(
    [...input.aliases].map(([id, alias]) => [alias, id] as const),
  );
  const clearResponses = new Map<
    string,
    { alias: string; responseSeconds: number[] }
  >();
  const countedClears = new Set<string>();
  for (const clear of input.timeline.filter(
    (event) => event.type === "clear" && event.actor,
  )) {
    const clearerId =
      clear.actorPlayerId ?? idByAlias.get(clear.actor!) ?? clear.actor!;
    const clearKey = `${clear.tick}:${clearerId}:${clear.victimPlayerId ?? clear.victim ?? ""}`;
    if (countedClears.has(clearKey)) continue;
    const pinEnd = [...input.timeline]
      .reverse()
      .find(
        (event) =>
          event.type === "pin_end" &&
          event.tick === clear.tick &&
          (clear.victimPlayerId !== undefined
            ? event.victimPlayerId === clear.victimPlayerId
            : event.victim === clear.victim) &&
          event.infectedClass === clear.infectedClass,
      );
    const pinStart =
      pinEnd === undefined
        ? undefined
        : [...input.timeline]
            .reverse()
            .find(
              (event) =>
                event.type === "pin_start" &&
                event.tick <= pinEnd.tick &&
                (pinEnd.actorPlayerId !== undefined
                  ? event.actorPlayerId === pinEnd.actorPlayerId
                  : event.actor === pinEnd.actor) &&
                (pinEnd.victimPlayerId !== undefined
                  ? event.victimPlayerId === pinEnd.victimPlayerId
                  : event.victim === pinEnd.victim),
            );
    if (!pinStart) continue;
    countedClears.add(clearKey);
    const summary = clearResponses.get(clearerId) ?? {
      alias: clear.actor!,
      responseSeconds: [],
    };
    summary.responseSeconds.push(
      Math.max(0, (clear.tick - pinStart.tick) * secondsPerTick),
    );
    clearResponses.set(clearerId, summary);
  }
  const clearStats: CompetitiveStats["clearStats"] = [...clearResponses].map(
    ([playerId, { alias, responseSeconds }]) => {
      const sorted = [...responseSeconds].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2
          ? sorted[middle]!
          : (sorted[middle - 1]! + sorted[middle]!) / 2;
      return {
        playerId,
        playerAlias: alias,
        deathCorrelatedClears: responseSeconds.length,
        responseSeconds,
        medianResponseSeconds: median,
      };
    },
  );

  const tankEncounters: CompetitiveStats["tankEncounters"] = infectedLives
    .filter((life) => life.infectedClass === "Tank")
    .map((life, index) => {
      const rows = input.projected.filter(
        (row) =>
          row.observation.playerEpochId === life.playerId &&
          row.observation.tick >= life.tickRange.start &&
          row.observation.tick <= life.tickRange.end,
      );
      const health = rows.flatMap((row) =>
        row.l4d2.health === undefined ? [] : [row.l4d2.health],
      );
      const frustration = rows.flatMap((row) =>
        row.l4d2.frustration === undefined ? [] : [row.l4d2.frustration],
      );
      const scopedEvents = input.timeline.filter(
        (event) =>
          event.tick >= life.tickRange.start &&
          event.tick <= life.tickRange.end,
      );
      const damageDealt = life.counterDeltas.m_checkpointPZTankDamage;
      const damageBySurvivor = playerIds.flatMap((playerId) => {
        const survivorRows = input.projected.filter(
          (row) =>
            row.observation.playerEpochId === playerId &&
            row.observation.team.value === 2 &&
            row.observation.tick >= life.tickRange.start &&
            row.observation.tick <= life.tickRange.end,
        );
        const damage =
          sumPositiveCounterDeltas(survivorRows).m_checkpointDamageToTank;
        return damage === undefined || damage <= 0
          ? []
          : [
              {
                playerId,
                playerAlias:
                  input.aliases.get(playerId) ?? playerId.slice(0, 8),
                damage,
              },
            ];
      });
      return {
        id: `tank-${index + 1}`,
        controllerId: life.playerId,
        controllerAlias: life.playerAlias,
        tickRange: life.tickRange,
        durationSeconds: life.durationSeconds,
        healthAtTake: health[0] ?? null,
        lowestObservedHealth: health.length ? Math.min(...health) : null,
        healthAtEnd: health.at(-1) ?? null,
        maximumObservedFrustration: frustration.length
          ? Math.max(...frustration)
          : null,
        punches: life.counterDeltas.m_checkpointPZTankPunches ?? 0,
        registeredRockThrows: life.counterDeltas.m_checkpointPZTankThrows ?? 0,
        damageDealt: damageDealt ?? null,
        damageTaken: damageBySurvivor.length
          ? damageBySurvivor.reduce((sum, player) => sum + player.damage, 0)
          : null,
        damageBySurvivor: damageBySurvivor.sort(
          (left, right) => right.damage - left.damage,
        ),
        survivorIncaps: scopedEvents.filter((event) => event.type === "incap")
          .length,
        survivorDeaths: scopedEvents.filter(
          (event) => event.type === "death" && !event.infectedClass,
        ).length,
        endReason:
          life.endReason === "death"
            ? ("death" as const)
            : life.endReason === "demo-end"
              ? ("demo-end" as const)
              : ("control-ended" as const),
      };
    });
  return {
    // Version 5 corrects checkpointZombieKills from a claimed CI count to a
    // total infected-kill counter. Earlier artifacts must be reanalyzed before
    // rating or presenting that field.
    derivationVersion: 6,
    rosters,
    halves,
    infectedLives,
    hits,
    clearStats,
    tankEncounters,
  };
}

function toCase(
  player: PlayerRealEvidence,
  observations: readonly ProjectedPlayerObservation[],
  mapName: string,
  demoSha256: string,
  stableToken: string | undefined,
  rejectedIdentityEntries: number,
  tickIntervalSeconds: number | undefined,
  observationArtifactSha256: string,
  evidenceArtifactSha256: string,
  configSha256: string,
  parserVersion: string,
): BundleCase {
  const evidence = player.result.evidence;
  const counterevidence = unique(
    evidence.flatMap((item) => item.counterevidence),
  );
  const limitations = unique(evidence.flatMap((item) => item.limitations));
  const skipLimitations = player.result.skipped.map(
    (skip) => `${skip.detectorId}: ${skip.explanation}`,
  );
  const windows = evidence.map((item) =>
    buildBoundedContextWindow(
      item.tickRange.start,
      item.tickRange.end,
      observations,
      tickIntervalSeconds,
    ),
  );
  const associationKey = stableToken ?? player.playerEpochId;
  const caseId = `case-${createHash("sha256").update(associationKey).digest("hex").slice(0, 24)}`;
  return {
    id: caseId,
    playerKey: associationKey,
    status: "unreviewed",
    score:
      evidence.length > 0
        ? {
            schemaVersion: 1,
            status: "ranked-evidence",
            label: "ranked evidence",
            researchOnly: true,
            numericPriorityWithheld: true,
            reasons: [
              `${evidence.length} server-observed aim window${evidence.length === 1 ? "" : "s"} met detector prerequisites`,
            ],
            strongestCounterevidence: counterevidence.slice(0, 3),
            limitations: unique([...limitations, ...skipLimitations]),
            independentEvidence: {
              demos: 1,
              signalFamilies: ["aim"],
              encounters: evidence.length,
            },
          }
        : {
            schemaVersion: 1,
            status: "insufficient-data",
            label: "insufficient data",
            researchOnly: true,
            numericPriorityWithheld: true,
            reasons: ["No detector window met the evidence prerequisites."],
            strongestCounterevidence: [],
            limitations: unique([
              ...skipLimitations,
              "No evidence window was emitted for this demo.",
            ]),
            independentEvidence: {
              demos: 1,
              signalFamilies: [],
              encounters: 0,
            },
          },
    evidence,
    windows,
    versions: {
      parser: parserVersion,
      schema: "observations/v1",
      detectors: ["aim-dynamics@1.0.0", "real-evidence@1.0.0"],
      model: "none-ranked-evidence",
    },
    config: {
      id: "real-aim-evidence-bundle/v1",
      sha256: configSha256,
      aim: defaultAimConfig,
      contextSeconds: CONTEXT_SECONDS,
      targetSelectionRule: "nearest-opposing-player-at-same-tick-v1",
      identity: {
        source: "L4D2 userinfo timeline",
        transform: "HMAC-SHA-256",
        keyPersisted: false,
        rejectedEntries: rejectedIdentityEntries,
      },
    },
    map: { name: mapName, assetVersion: "unavailable" },
    derivation: [
      `demo SHA-256 → projected observations ${observationArtifactSha256}`,
      "userinfo Steam identity → display identity plus keyed HMAC join token",
      `projected observations → aim evidence ${evidenceArtifactSha256}`,
      "aim evidence → bounded eight-second review windows",
    ],
    limitations: unique([
      ...limitations,
      ...skipLimitations,
      "SourceTV eye angles are server-observed and are not direct mouse input.",
      "Map geometry, authoritative visibility, audibility, and shot timing are unavailable in this bundle.",
      "One demo and one signal family cannot support a probability or enforcement decision.",
    ]),
    presentation: {
      schemaVersion: 1,
      id: caseId,
      alias: `Player ${createHash("sha256").update(associationKey).digest("hex").slice(0, 8)}`,
      identityLabel:
        stableToken === undefined
          ? "Demo-local player epoch · stable identity unavailable"
          : "Privacy-stable player token",
      provenance: {
        controlledFixture: false,
        label: "Derived from the referenced real demo artifact",
      },
      demos: [
        {
          id: `demo-${demoSha256.slice(0, 16)}`,
          sha256: demoSha256,
          mapName,
          sourceLabel: "content-addressed demo artifact",
          quality: {
            value:
              evidence.length === 0
                ? null
                : evidence.reduce((sum, item) => sum + item.quality.value, 0) /
                  evidence.length,
            basis:
              evidence.length === 0
                ? ["no detector evidence window in this demo"]
                : ["mean quality of retained evidence windows"],
          },
          corroboration:
            stableToken === undefined ? "unassociated" : "same-stable-player",
        },
      ],
      evidence: evidence.map((item, index) => ({
        id: item.id,
        family: item.kind,
        title: "Server-observed aim dynamics",
        tick: Math.floor((item.tickRange.start + item.tickRange.end) / 2),
        tickRange: item.tickRange,
        quality: { value: item.quality.value, basis: [...item.quality.basis] },
        contribution: null,
        explanation: item.explanation,
        counterevidence: [...item.counterevidence],
        limitations: [...item.limitations],
        demoSha256,
        window: {
          startTick: windows[index]!.startTick,
          endTick: windows[index]!.endTick,
          contextSeconds: CONTEXT_SECONDS,
        },
      })),
      association:
        stableToken === undefined
          ? {
              kind: "demo-local-epoch",
              corroboratingDemoCount: 0,
              explanation:
                "Stable privacy-preserving identity was unavailable; no corroborating demo is claimed.",
            }
          : {
              kind: "stable-privacy-token",
              stableToken,
              corroboratingDemoCount: 0,
              explanation:
                "Userinfo identity was transformed with keyed HMAC; raw identity was discarded.",
            },
      summary: {
        encounterCount: evidence.length,
        independentSignalFamilies: ["aim"],
      },
    },
  };
}

export function buildBoundedContextWindow(
  evidenceStart: number,
  evidenceEnd: number,
  observations: readonly ProjectedPlayerObservation[],
  tickIntervalSeconds: number | undefined,
) {
  const ticksPerSecond =
    tickIntervalSeconds === undefined ? 30 : 1 / tickIntervalSeconds;
  const desiredTicks = Math.min(
    MAX_WINDOW_TICKS,
    Math.max(1, Math.round(CONTEXT_SECONDS * ticksPerSecond)),
  );
  const midpoint = Math.floor((evidenceStart + evidenceEnd) / 2);
  const startTick = Math.max(0, midpoint - Math.floor(desiredTicks / 2));
  const endTick = startTick + desiredTicks;
  const source = observations.filter(
    ({ observation }) =>
      observation.tick >= startTick && observation.tick < endTick,
  );
  let stride = Math.max(1, Math.ceil(source.length / MAX_WINDOW_OBSERVATIONS));
  const retain = () =>
    source
      .filter((_, index) => index % stride === 0)
      .slice(0, MAX_WINDOW_OBSERVATIONS)
      .map(({ observation }) => ({
        tick: observation.tick,
        playerEpochId: observation.playerEpochId,
        demoTimeSeconds: observation.demoTimeSeconds,
        position: observation.position,
        eyeAngles: observation.eyeAngles,
        team: observation.team,
      }));
  let retained = retain();
  const payload = () => ({
    schemaVersion: 1,
    bounded: true,
    contextSeconds: CONTEXT_SECONDS,
    startTick,
    endTick,
    samplingStride: stride,
    sourceObservationCount: source.length,
    retainedObservationCount: retained.length,
    observations: retained,
    availability: {
      mapGeometry: "unavailable",
      visibility: "unavailable",
      audibility: "unavailable",
      shotTiming: "unavailable",
    },
  });
  while (
    retained.length > 1 &&
    Buffer.byteLength(JSON.stringify(payload())) > MAX_WINDOW_PAYLOAD_BYTES
  ) {
    stride *= 2;
    retained = retain();
  }
  if (Buffer.byteLength(JSON.stringify(payload())) > MAX_WINDOW_PAYLOAD_BYTES)
    throw new RangeError(
      "bounded telemetry window cannot fit the payload budget",
    );
  return {
    startTick,
    endTick,
    payload: payload(),
  };
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];
