import { createHash } from "node:crypto";
import type { NativeFramingSummary } from "./native-demo-provider.js";

export interface DemoInspection {
  readonly schemaVersion: 1;
  readonly sha256: string;
  readonly bytes: number;
  readonly header: Pick<
    NativeFramingSummary,
    | "stamp"
    | "demoProtocol"
    | "networkProtocol"
    | "mapName"
    | "gameDirectory"
    | "playbackTimeSeconds"
    | "playbackTicks"
    | "playbackFrames"
    | "signonLength"
  >;
  readonly headerLabelSha256: {
    readonly serverName: string;
    readonly clientName: string;
  };
  readonly commandCounts: Readonly<Record<string, number>>;
  readonly commandSequenceSha256: string;
  readonly issues: NativeFramingSummary["issues"];
  readonly telemetryAvailability: {
    readonly playerIdentity: "not-evaluated-by-lightweight-inspect";
    readonly gameEvents: "not-evaluated-by-lightweight-inspect";
    readonly playerPositions: "not-evaluated-by-lightweight-inspect";
    readonly playerEyeAngles: "not-evaluated-by-lightweight-inspect";
    readonly weaponAndFire: "not-evaluated-by-lightweight-inspect";
    readonly userCommands: "unavailable-for-sourcetv";
  };
  readonly limitations: readonly string[];
}

export const summarizeNativeDemo = (
  input: { demoSha256: string; bytes: number },
  framing: NativeFramingSummary,
): DemoInspection => ({
  schemaVersion: 1,
  sha256: input.demoSha256,
  bytes: input.bytes,
  header: {
    stamp: framing.stamp,
    demoProtocol: framing.demoProtocol,
    networkProtocol: framing.networkProtocol,
    mapName: framing.mapName,
    gameDirectory: framing.gameDirectory,
    playbackTimeSeconds: framing.playbackTimeSeconds,
    playbackTicks: framing.playbackTicks,
    playbackFrames: framing.playbackFrames,
    signonLength: framing.signonLength,
  },
  headerLabelSha256: {
    serverName: createHash("sha256").update(framing.serverName).digest("hex"),
    clientName: createHash("sha256").update(framing.clientName).digest("hex"),
  },
  commandCounts: Object.fromEntries(
    framing.commandCounts
      .map(({ kind, count }) => [kind, count] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
  commandSequenceSha256: framing.commandSequenceSha256,
  issues: framing.issues,
  telemetryAvailability: {
    playerIdentity: "not-evaluated-by-lightweight-inspect",
    gameEvents: "not-evaluated-by-lightweight-inspect",
    playerPositions: "not-evaluated-by-lightweight-inspect",
    playerEyeAngles: "not-evaluated-by-lightweight-inspect",
    weaponAndFire: "not-evaluated-by-lightweight-inspect",
    userCommands: "unavailable-for-sourcetv",
  },
  limitations: [
    "The inspect command validates outer framing only; deep entity, identity, and event projection use dedicated streaming commands and corpus gates.",
    "Packet command-info view angles in SourceTV demos describe the TV recorder, not individual players.",
    "Unavailable telemetry is never substituted with zero-valued observations.",
  ],
});

export const stableJson = (value: unknown): string =>
  `${JSON.stringify(sortValue(value), null, 2)}\n`;

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Uint8Array
  )
    return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
};
