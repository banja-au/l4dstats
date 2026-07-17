import { createHash } from "node:crypto";
import { decodeDemo } from "@witchwatch/demo-source1";
import {
  buildRealAimEvidence,
  defaultAimConfig,
  type PlayerRealEvidence,
} from "@witchwatch/detectors";
import {
  collectL4d2UserInfoTimeline,
  projectL4d2PlayerObservations,
  type ProjectedPlayerObservation,
} from "@witchwatch/l4d2-schema";

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

export interface EvidenceBundle {
  schemaVersion: 1;
  demo: { sha256: string; mapName: string; bytes: number };
  cases: BundleCase[];
}

export function buildEvidenceBundle(
  bytes: Uint8Array,
  options: { pseudonymKey: string | Uint8Array },
): EvidenceBundle {
  const demoSha256 = createHash("sha256").update(bytes).digest("hex");
  const decoded = decodeDemo(bytes);
  const tickIntervalSeconds =
    decoded.header.playbackTicks > 0 && decoded.header.playbackTimeSeconds > 0
      ? decoded.header.playbackTimeSeconds / decoded.header.playbackTicks
      : undefined;
  const observations: ProjectedPlayerObservation[] = [];
  const identityTimeline = collectL4d2UserInfoTimeline(bytes, {
    pseudonymKey: options.pseudonymKey,
  });
  const projection = projectL4d2PlayerObservations(bytes, {
    demoSha256,
    ...(tickIntervalSeconds === undefined ? {} : { tickIntervalSeconds }),
    userInfo: identityTimeline.mappings,
    onObservation: (observation) => {
      observations.push(observation);
    },
  });
  const detected = buildRealAimEvidence({ demoSha256, observations });
  const stableTokens = new Map(
    projection.playerEpochs.flatMap((epoch) =>
      epoch.steamId.value === undefined
        ? []
        : ([[epoch.id, epoch.steamId.value]] as const),
    ),
  );
  return {
    schemaVersion: 1,
    demo: {
      sha256: demoSha256,
      mapName: decoded.header.mapName,
      bytes: bytes.byteLength,
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
          decoded.header.mapName,
          demoSha256,
          stableTokens.get(player.playerEpochId),
          identityTimeline.rejectedEntries,
          tickIntervalSeconds,
          detected.artifact.observationArtifactSha256,
          detected.evidenceArtifactSha256,
          detected.artifact.configSha256,
        ),
      ),
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
      parser: "demo-source1@0.0.0",
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
      "userinfo Steam identity → keyed HMAC privacy token; raw identity discarded",
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
