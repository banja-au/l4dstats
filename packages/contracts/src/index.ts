export const evidenceKinds = [
  "aim",
  "awareness",
  "movement",
  "invariant",
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export interface TickRange {
  readonly start: number;
  readonly end: number;
}

export interface EvidenceEvent {
  readonly id: string;
  readonly demoSha256: string;
  readonly playerId: string;
  readonly tickRange: TickRange;
  readonly kind: EvidenceKind;
  readonly detectorVersion: string;
  readonly quality: number;
  readonly contribution: number;
  readonly explanation: string;
  readonly counterevidence: readonly string[];
}

export const evidenceSchemaVersion = 1 as const;

export type FeatureValue = boolean | number | string | null;

export interface ArtifactProvenance {
  readonly demoSha256: string;
  readonly observationArtifactSha256: string;
  readonly observationSchemaVersion: number;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly configSha256: string;
  readonly mapAssetSha256?: string;
}

export interface EvidenceEffect {
  readonly value: number;
  readonly unit: string;
  readonly baseline: string;
}

export interface EvidenceQuality {
  readonly value: number;
  readonly basis: readonly string[];
}

export interface DetectorEvidence {
  readonly schemaVersion: typeof evidenceSchemaVersion;
  readonly id: string;
  readonly playerEpochId: string;
  readonly kind: EvidenceKind;
  readonly tickRange: TickRange;
  readonly rawFeatures: Readonly<Record<string, FeatureValue>>;
  readonly effect: EvidenceEffect;
  readonly contributionPlaceholder: null;
  readonly quality: EvidenceQuality;
  readonly explanation: string;
  readonly limitations: readonly string[];
  readonly counterevidence: readonly string[];
  readonly provenance: ArtifactProvenance;
}

export interface DetectorSkip {
  readonly detectorId: string;
  readonly code:
    | "empty-input"
    | "missing-prerequisite"
    | "insufficient-samples"
    | "no-candidate";
  readonly explanation: string;
  readonly unavailableFields: readonly string[];
}

export interface EvidenceBundle {
  readonly schemaVersion: typeof evidenceSchemaVersion;
  readonly demoSha256: string;
  readonly configSha256: string;
  readonly findings: readonly DetectorEvidence[];
  readonly skipped: readonly DetectorSkip[];
}

export const scoreSchemaVersion = 1 as const;
export type ScoreStatus =
  | "insufficient-data"
  | "ranked-evidence"
  | "calibrated-priority";

export interface ScoreModelIdentity {
  readonly id: string;
  readonly version: string;
  readonly bundleSha256: string;
}

export interface IndependentEvidenceCount {
  readonly encounters: number;
  readonly demos: number;
  readonly signalFamilies: number;
}

export interface ScoreContribution {
  readonly featureId: string;
  readonly rawValue: number;
  readonly cappedValue: number;
  readonly coefficient: number;
  readonly logOddsContribution: number;
  readonly evidenceIds: readonly string[];
  readonly tickRanges: readonly TickRange[];
  readonly explanation: string;
  readonly limitations: readonly string[];
  readonly counterevidence: readonly string[];
}

export interface ScoreProvenance {
  readonly evidenceBundleSha256s: readonly string[];
  readonly detectorVersions: Readonly<Record<string, string>>;
  readonly configSha256: string;
  readonly modelBundleSha256: string;
  readonly datasetManifestSha256: string;
}

interface ScoreCommon {
  readonly schemaVersion: typeof scoreSchemaVersion;
  readonly playerKey: string;
  readonly model: ScoreModelIdentity;
  readonly policyVersion: string;
  readonly dataQuality: number;
  readonly reconstructionQuality: number;
  readonly independentEvidence: IndependentEvidenceCount;
  readonly contributions: readonly ScoreContribution[];
  readonly strongestCounterevidence: readonly string[];
  readonly limitations: readonly string[];
  readonly provenance: ScoreProvenance;
  readonly researchOnly: true;
}

export interface InsufficientDataScore extends ScoreCommon {
  readonly status: "insufficient-data";
  readonly label: "insufficient-data";
  readonly reasons: readonly string[];
}

export interface RankedEvidenceScore extends ScoreCommon {
  readonly status: "ranked-evidence";
  readonly label: "review" | "highly-anomalous";
  readonly uncalibratedEvidenceStrength: number;
  readonly reasons: readonly string[];
}

export interface CalibratedPriorityScore extends ScoreCommon {
  readonly status: "calibrated-priority";
  readonly label: "review" | "highly-anomalous";
  readonly reviewPriority: number;
  readonly calibration: {
    readonly method: "platt";
    readonly reportSha256: string;
  };
}

/** Review-priority output. Only the calibrated variant can contain a numeric priority. */
export type ReviewScore =
  | InsufficientDataScore
  | RankedEvidenceScore
  | CalibratedPriorityScore;

export const observationSchemaVersion = 1 as const;
export type Availability = "observed" | "derived" | "unavailable";

export interface AvailableValue<T> {
  readonly availability: Availability;
  readonly value?: T;
  readonly reason?: string;
}

export interface DemoIdentity {
  readonly sha256: string;
  readonly demoProtocol: number;
  readonly networkProtocol: number;
  readonly mapName: string;
  readonly gameDirectory: string;
  readonly playbackTicks: number;
  readonly playbackTimeSeconds: number;
}

/** Recording vantage point. Unknown is retained when svc_ServerInfo is absent. */
export type DemoSourcePerspective = "source-tv" | "player-pov" | "unknown";

export interface PlayerEpoch {
  readonly id: string;
  readonly demoSha256: string;
  readonly entitySlot: number;
  readonly userId: AvailableValue<number>;
  readonly steamId: AvailableValue<string>;
  readonly connectedAtTick: number;
  readonly disconnectedAtTick: AvailableValue<number>;
}

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ViewAngles {
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export interface PlayerObservation {
  readonly schemaVersion: typeof observationSchemaVersion;
  readonly demoSha256: string;
  readonly playerEpochId: string;
  readonly tick: number;
  readonly demoTimeSeconds: AvailableValue<number>;
  readonly position: AvailableValue<Vector3>;
  readonly eyeAngles: AvailableValue<ViewAngles>;
  readonly team: AvailableValue<number>;
  readonly playerClass: AvailableValue<string>;
  readonly weapon: AvailableValue<string>;
  readonly buttons: AvailableValue<number>;
}

/**
 * One command submitted by the client that recorded a player-POV demo.
 * It describes recorder intent, not authoritative movement, firing, hits, or
 * the physical mouse device.
 */
export interface RecorderCommandObservation {
  readonly schemaVersion: typeof observationSchemaVersion;
  readonly demoSha256: string;
  readonly demoTick: number;
  readonly demoTimeSeconds: AvailableValue<number>;
  readonly recorderPlayerEpochId: AvailableValue<string>;
  readonly outgoingSequence: number;
  readonly commandNumber: number;
  readonly clientTickCount: number;
  readonly viewAngles: ViewAngles;
  readonly intendedMovement: {
    readonly forward: number;
    readonly side: number;
    readonly up: number;
  };
  readonly buttons: number;
  readonly impulse: number;
  readonly weaponSelect: AvailableValue<number>;
  readonly weaponSubtype: AvailableValue<number>;
  readonly mouseDelta: { readonly x: number; readonly y: number };
  readonly provenance: {
    readonly source: "dem_usercmd";
    readonly scope: "recorder-only";
    readonly semantics: "client-command-intent";
  };
}

export interface RecorderCommandCoverage {
  readonly availability: "observed" | "unavailable";
  readonly totalCommands: number;
  readonly decodedCommands: number;
  readonly malformedCommands: number;
  readonly commandGaps: number;
  readonly firstDemoTick: number | null;
  readonly lastDemoTick: number | null;
  readonly recorderPlayerEpochId: AvailableValue<string>;
  readonly unavailableReason?: string;
}

export interface GameEventObservation {
  readonly schemaVersion: typeof observationSchemaVersion;
  readonly demoSha256: string;
  readonly tick: number;
  readonly name: string;
  readonly fields: Readonly<Record<string, boolean | number | string>>;
}

export interface ProtocolCoverage {
  readonly demoSha256: string;
  readonly decodedCommandCounts: Readonly<Record<string, number>>;
  readonly unknownCommandCounts: Readonly<Record<string, number>>;
  readonly unknownMessageCounts: Readonly<Record<string, number>>;
  readonly unavailableFields: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

export interface CanonicalDemo {
  readonly schemaVersion: typeof observationSchemaVersion;
  readonly identity: DemoIdentity;
  readonly playerEpochs: readonly PlayerEpoch[];
  readonly observations: readonly PlayerObservation[];
  readonly events: readonly GameEventObservation[];
  readonly coverage: ProtocolCoverage;
  readonly sourcePerspective?: DemoSourcePerspective;
  readonly recorderCommands?: readonly RecorderCommandObservation[];
  readonly recorderCommandCoverage?: RecorderCommandCoverage;
}

/** Parser-neutral Source 1 demo header metadata. */
export interface DemoHeader {
  readonly stamp: "HL2DEMO";
  readonly demoProtocol: number;
  readonly networkProtocol: number;
  readonly serverName: string;
  readonly clientName: string;
  readonly mapName: string;
  readonly gameDirectory: string;
  readonly playbackTimeSeconds: number;
  readonly playbackTicks: number;
  readonly playbackFrames: number;
  readonly signonLength: number;
}

export interface DecodeIssue {
  readonly code: "UNKNOWN_DEMO_COMMAND" | "TRAILING_DATA";
  readonly offset: number;
  readonly command?: number;
  readonly message: string;
}

export interface L4d2ServerInfo {
  readonly networkProtocol: number;
  readonly serverCount: number;
  readonly isSourceTv: boolean;
  readonly dedicated: boolean;
  readonly maxServerClasses: number;
  readonly playerCount: number;
  readonly maxClients: number;
  readonly tickIntervalSeconds: number;
  readonly platformCode: number;
}

export type GameEventValue = boolean | number | string;
export type GameEventFieldType =
  | "string"
  | "float"
  | "long"
  | "short"
  | "byte"
  | "boolean"
  | "uint64";

export interface GameEventFieldSchema {
  readonly name: string;
  readonly type: GameEventFieldType;
}

export interface GameEventSchema {
  readonly id: number;
  readonly name: string;
  readonly fields: readonly GameEventFieldSchema[];
}

export interface DecodedGameEvent {
  readonly id: number;
  readonly name: string;
  readonly fields: Readonly<Record<string, GameEventValue>>;
  readonly schema: GameEventSchema;
}

export interface EventFieldAvailability<T extends GameEventValue> {
  readonly availability: "observed" | "unavailable";
  readonly value?: T;
  readonly provenance?: {
    readonly message: "svc_GameEvent";
    readonly eventId: number;
    readonly field: string;
  };
  readonly reason?: string;
}

export type RequiredGameEventName =
  | "weapon_fire"
  | "player_hurt"
  | "player_hurt_concise"
  | "player_death";

export interface RequiredGameEventProjection {
  readonly name: RequiredGameEventName;
  readonly eventId: number;
  readonly tick: number;
  readonly actorUserId: EventFieldAvailability<number>;
  readonly victimUserId: EventFieldAvailability<number>;
  readonly attackerUserId: EventFieldAvailability<number>;
  /** Entity index used by concise hurt; it is not a stable player identity. */
  readonly attackerEntityId: EventFieldAvailability<number>;
  readonly weapon: EventFieldAvailability<string>;
  readonly damage: EventFieldAvailability<number>;
  readonly health: EventFieldAvailability<number>;
  readonly damageType: EventFieldAvailability<number>;
  readonly decoded: DecodedGameEvent;
}

export interface GameEventVisit {
  readonly demoTick: number;
  readonly engineTick: number | null;
  readonly event: DecodedGameEvent;
  readonly required: RequiredGameEventProjection | null;
}

export interface GameEventTelemetrySummary {
  readonly schemaLists: number;
  readonly schemas: number;
  readonly events: number;
  readonly requiredEvents: Readonly<Record<string, number>>;
}

export interface ProjectableUserInfo {
  readonly entityIndex: number;
  readonly userInfoSlot: number;
  readonly userId?: number;
  readonly stableIdentityToken?: string;
  readonly effectiveTick?: number;
}

export interface DisplayUserInfoIdentity {
  readonly entityIndex: number;
  readonly userInfoSlot: number;
  readonly userId: number;
  readonly effectiveTick?: number;
  readonly displayName: string;
  readonly fakePlayer: boolean;
  readonly steamId64?: string;
}

export interface L4d2WitchObservation {
  readonly entityIndex: number;
  readonly lifetime: number;
  readonly tick: number;
  readonly timeSeconds?: number | undefined;
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
  readonly counters?: Readonly<Partial<Record<L4d2CounterName, number>>>;
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

export type L4d2CounterName =
  | "m_checkpointSurvivorDamage"
  | "m_checkpointMedkitsUsed"
  | "m_checkpointPillsUsed"
  | "m_checkpointMolotovsUsed"
  | "m_checkpointPipebombsUsed"
  | "m_checkpointBoomerBilesUsed"
  | "m_checkpointAdrenalinesUsed"
  | "m_checkpointDefibrillatorsUsed"
  | "m_checkpointDamageTaken"
  | "m_checkpointFirstAidShared"
  | "m_checkpointDamageToTank"
  | "m_checkpointDamageToWitch"
  | "m_missionAccuracy"
  | "m_checkpointHeadshots"
  | "m_checkpointHeadshotAccuracy"
  | "m_checkpointDeaths"
  | "m_checkpointMeleeKills"
  | "m_checkpointPZTankDamage"
  | "m_checkpointPZHunterDamage"
  | "m_checkpointPZSmokerDamage"
  | "m_checkpointPZBoomerDamage"
  | "m_checkpointPZJockeyDamage"
  | "m_checkpointPZSpitterDamage"
  | "m_checkpointPZChargerDamage"
  | "m_checkpointPZKills"
  | "m_checkpointPZPushes"
  | "m_checkpointPZTankPunches"
  | "m_checkpointPZTankThrows"
  | "m_checkpointPZHung"
  | "m_checkpointPZPulled"
  | "m_checkpointPZBombed"
  | "m_checkpointPZVomited"
  | "m_checkpointPZLongestSmokerGrab"
  | "m_checkpointPZNumChargeVictims";

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

export interface L4d2MatchState {
  readonly tick: number;
  readonly campaignScores: readonly (number | null)[];
  readonly chapterScores: readonly (number | null)[];
  readonly survivorScores: readonly (number | null)[];
  readonly survivorDistances: readonly (number | null)[];
  readonly survivorDeathDistances: readonly (number | null)[];
  readonly roundDurations: readonly (number | null)[];
  readonly roundNumber?: number | undefined;
  readonly teamsFlipped?: boolean | undefined;
  readonly secondHalf?: boolean | undefined;
  readonly voteRestarting?: boolean | undefined;
  readonly roundSetupTimeRemaining?: number | undefined;
}
