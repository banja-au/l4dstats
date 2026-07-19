import type { ReviewState } from "./data";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Workbench API returned ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export interface ApiNote {
  id: string;
  body: string;
  createdAt: string;
}

export interface ApiJob {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  message: string | null;
  source: { kind: "local" | "remote"; sha256?: string; bytes?: number };
  analysis?: JobAnalysis;
}

export interface PlayerStats {
  id: string;
  alias: string;
  identity?: {
    displayName: string;
    inference?: "observed" | "unique-slot-v1";
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
  survivorDeaths?: number;
  infectedDeaths?: number;
  specialInfectedKills?: number;
  headshotKills?: number;
  checkpointInfectedKills?: number | undefined;
  revives?: number | undefined;
  survivorIncaps?: number | undefined;
  specialIncaps?: number | undefined;
  pounces?: number | undefined;
  highestPounceDamage?: number | undefined;
  longestJockeyRide?: number | undefined;
  pinSeconds?: number;
  ghostSeconds?: number;
  observedHealthLost?: number;
  killsByWeapon?: Record<string, number>;
  killsByInfectedClass?: Record<string, number>;
  playedSurvivor?: boolean;
  playedInfected?: boolean;
  infectedClasses?: string[];
  counters?: Record<string, number>;
}

export interface MatchTimelineEvent {
  tick: number;
  timeSeconds: number;
  type:
    | "round_start"
    | "round_end"
    | "death"
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
  detail: string;
  position?: { x: number; y: number; z: number };
}

export interface MapGeometry {
  format: "witchwatch-map-mesh-v1";
  bspVersion: number;
  mapRevision: number;
  positions: number[];
  indices: number[];
  /** Triangle centroid heights used for analytical floor slicing. */
  triangleZ: number[];
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  coverage: {
    worldFaces: number;
    emittedFaces: number;
    emittedTriangles: number;
    skippedToolFaces: number;
    skippedDisplacements: number;
    emittedDisplacements: number;
    rejectedFaces: number;
    staticProps: "unavailable";
    dynamicState: "unavailable";
    compression: {
      codec: "valve-source-lzma1";
      decoder: "@napi-rs/lzma@1.5.1";
      decodedLumps: number[];
      decodedBytes: number;
    };
  };
  provenance: {
    map: string;
    sourceBspSha256: string;
    sourceBytes: number;
    sourceKind: "steam-dedicated-server" | "local-bsp";
    steamAppId?: 222860;
    steamBuildId?: string;
    contentRoot?: string;
    extractor: string;
  };
}

export interface DemoStats {
  durationSeconds: number;
  playbackTicks: number;
  tickRate: number | null;
  playerCount: number;
  observationCount: number;
  eventCount: number;
  requiredEvents: Record<string, number>;
  decodeIssueCount: number;
  availability: Record<
    "position" | "eyeAngles" | "team" | "playerClass" | "weapon",
    number
  >;
  match?: {
    roundStarts: number;
    roundEnds: number;
    survivorDeaths: number;
    specialInfectedDeaths: number;
    tankDeaths: number;
    witchDeaths: number;
    specialKillsByClass: Record<string, number>;
    killsByWeapon: Record<string, number>;
    campaignScores?: Array<number | null>;
    chapterScores?: Array<number | null>;
    survivorScores?: Array<number | null>;
    survivorDistances?: Array<number | null>;
    survivorDeathDistances?: Array<number | null>;
    roundDurations?: Array<number | null>;
    roundNumber?: number | null;
    teamsFlipped?: boolean | null;
    secondHalf?: boolean | null;
    scoreTimeline?: Array<{
      tick: number;
      timeSeconds: number;
      campaignScores: Array<number | null>;
      chapterScores: Array<number | null>;
      survivorScores: Array<number | null>;
      survivorDistances: Array<number | null>;
      teamsFlipped: boolean | null;
      secondHalf: boolean | null;
      voteRestarting?: boolean | null;
      roundSetupTimeRemaining?: number | null;
    }>;
  };
  timeline?: MatchTimelineEvent[];
  competitive?: CompetitiveStats;
  witchEncounters?: WitchEncounter[];
  survivorHealthTraces?: SurvivorHealthTrace[];
  survivorLoadoutTraces?: SurvivorLoadoutTrace[];
  survivorAmmoTraces?: SurvivorAmmoTrace[];
  spectators?: Array<{
    displayName: string;
    steamId64?: string;
    steamProfileUrl?: string;
  }>;
  players: PlayerStats[];
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
    primaryWeapon?: LoadoutItem | null;
    firstAid?: LoadoutItem | null;
    temporaryHealth?: LoadoutItem | null;
  }>;
}

export interface LoadoutItem {
  id: number;
  name: string;
  category:
    | "primary"
    | "secondary"
    | "medical"
    | "temporary-health"
    | "utility"
    | "infected"
    | "world"
    | "unknown";
}

export interface SurvivorHealthTrace {
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
}

export interface WitchEncounter {
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
      limitations: string[];
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
  rosters?: Array<{
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
      counterDeltas: Record<string, number>;
      observedCounters?: string[];
      summary?: CompetitiveHalfPlayerSummary;
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
    /** Checkpoint damage credited while this player controlled the Tank. */
    damageDealt?: number | null;
    damageTaken?: number | null;
    damageBySurvivor?: Array<{
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

export interface JobAnalysis {
  jobId: string;
  gameId?: string | null;
  demoSha256: string;
  engineResultSha256: string;
  engineResult: {
    schemaVersion: 1;
    demo: {
      parser?: {
        engine: "rust-native";
        coreVersion: string;
        bindingVersion: string | null;
        bindingApiVersion: number | null;
        configVersion: number;
        wireVersion: number;
        parserConfigId: string;
        buildSha256: string | null;
      };
      sha256: string;
      mapName: string;
      bytes: number;
      session?: {
        serverToken: string | null;
        rosterToken: string | null;
        serverCount: number | null;
        campaign: string | null;
        chapter: number | null;
        evidence: string[];
      };
      stats?: DemoStats;
    };
    cases: Array<{
      id: string;
      evidence: unknown[];
      presentation?: CasePresentationV1;
      versions?: {
        parser: string;
        schema: string;
        detectors: string[];
        model: string;
      };
      config?: unknown;
      limitations?: string[];
    }>;
  };
}

export interface ApiGame {
  id: string;
  confidence: "provisional" | "high" | "unassociated";
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  analyses: JobAnalysis[];
}

export interface ApiCase {
  id: string;
  playerKey: string;
  status: ReviewState;
  scoreJson: string;
  createdAt: string;
  updatedAt: string;
  score?: Record<string, unknown>;
  presentation?: CasePresentationV1;
  lineage?: Record<string, unknown>;
}

export interface CasePresentationV1 {
  schemaVersion: 1;
  id: string;
  alias: string;
  identityLabel: string;
  provenance: { controlledFixture: boolean; label: string };
  demos: Array<{
    id: string;
    sha256: string;
    mapName: string;
    sourceLabel: string;
    quality: { value: number | null; basis: string[] };
    corroboration: "same-stable-player" | "unassociated";
  }>;
  evidence: Array<{
    id: string;
    family: string;
    title: string;
    tick: number;
    tickRange: { start: number; end: number };
    quality: { value: number; basis: string[] };
    contribution: number | null;
    explanation: string;
    counterevidence: string[];
    limitations: string[];
    demoSha256: string;
    window: { startTick: number; endTick: number; contextSeconds: number };
  }>;
  association: {
    kind: "stable-privacy-token" | "demo-local-epoch";
    stableToken?: string;
    corroboratingDemoCount: number;
    explanation: string;
  };
  summary: { encounterCount: number; independentSignalFamilies: string[] };
}

export interface TelemetryWindow {
  caseId: string;
  startTick: number;
  endTick: number;
  chunks: Array<{
    schemaVersion?: number;
    startTick?: number;
    endTick?: number;
    bounded?: boolean;
    poses?: Array<{
      tick: number;
      subject: [number, number];
      target: [number, number];
    }>;
  }>;
}

export const workbenchApi = {
  async mapGeometry(map: string): Promise<MapGeometry | null> {
    const response = await fetch(
      `/api/maps/${encodeURIComponent(map)}/geometry`,
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Map geometry failed with ${response.status}`);
    return response.json() as Promise<MapGeometry>;
  },
  async uploadDemo(file: File): Promise<{
    job: ApiJob;
    upload: { filename: string; bytes: number; sha256: string };
  }> {
    const response = await fetch(
      `/api/uploads?filename=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(payload.error ?? `Upload failed with ${response.status}`);
    }
    return response.json() as Promise<{
      job: ApiJob;
      upload: { filename: string; bytes: number; sha256: string };
    }>;
  },
  async cases(): Promise<ApiCase[]> {
    const summaries = (
      await requestJson<{ items: ApiCase[] }>("/api/cases?limit=100&offset=0")
    ).items;
    return Promise.all(
      summaries.map((item) =>
        requestJson<ApiCase>(`/api/cases/${encodeURIComponent(item.id)}`),
      ),
    );
  },
  case(caseId: string) {
    return requestJson<ApiCase>(`/api/cases/${encodeURIComponent(caseId)}`);
  },
  telemetry(
    caseId: string,
    startTick: number,
    endTick: number,
    demoSha256?: string,
  ) {
    return requestJson<TelemetryWindow>(
      `/api/cases/${encodeURIComponent(caseId)}/telemetry?start=${startTick}&end=${endTick}${demoSha256 ? `&demo=${encodeURIComponent(demoSha256)}` : ""}`,
    );
  },
  createJob(
    source: { kind: "local"; path: string } | { kind: "remote"; url: string },
  ) {
    return requestJson<ApiJob>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        source,
        idempotencyKey: `${source.kind}:${source.kind === "local" ? source.path : source.url}`,
      }),
    });
  },
  job(id: string) {
    return requestJson<ApiJob>(`/api/jobs/${encodeURIComponent(id)}`);
  },
  game(id: string) {
    return requestJson<ApiGame>(`/api/games/${encodeURIComponent(id)}`);
  },
  cancelJob(id: string) {
    return requestJson<ApiJob>(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  },
  retryJob(id: string) {
    return requestJson<ApiJob>(`/api/jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    });
  },
  reanalyzeJob(id: string) {
    return requestJson<ApiJob>(
      `/api/jobs/${encodeURIComponent(id)}/reanalyze`,
      { method: "POST" },
    );
  },
  async reviewStatus(caseId: string): Promise<ReviewState> {
    return (
      await requestJson<{ status: ReviewState }>(
        `/api/cases/${encodeURIComponent(caseId)}`,
      )
    ).status;
  },
  setReviewStatus(caseId: string, status: ReviewState) {
    return requestJson(
      `/api/cases/${encodeURIComponent(caseId)}/review-status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      },
    );
  },
  addNote(caseId: string, body: string, tick: number | null) {
    return requestJson<ApiNote>(
      `/api/cases/${encodeURIComponent(caseId)}/notes`,
      { method: "POST", body: JSON.stringify({ body, tick }) },
    );
  },
  async notes(caseId: string): Promise<ApiNote[]> {
    return (
      await requestJson<{ items: ApiNote[] }>(
        `/api/cases/${encodeURIComponent(caseId)}/notes`,
      )
    ).items;
  },
  async downloadVerifiedReport(caseId: string): Promise<string> {
    const result = await requestJson<{
      sha256: string;
      canonicalJson: string;
    }>(`/api/cases/${encodeURIComponent(caseId)}/report`);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(result.canonicalJson),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== result.sha256)
      throw new Error("Report failed SHA-256 verification");
    const url = URL.createObjectURL(
      new Blob([result.canonicalJson], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${caseId}-${result.sha256}.report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    return result.sha256;
  },
};
