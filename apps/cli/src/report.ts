import type { DemoDecodeResult } from "@witchwatch/demo-source1";
import { createHash } from "node:crypto";

export interface DemoInspection {
  readonly schemaVersion: 1;
  readonly sha256: string;
  readonly bytes: number;
  readonly header: Pick<
    DemoDecodeResult["header"],
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
  readonly issues: DemoDecodeResult["issues"];
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

export const summarizeDemo = (
  result: DemoDecodeResult,
  sha256: string,
  bytes: number,
): DemoInspection => {
  const commandCounts: Record<string, number> = {};
  for (const frame of result.frames)
    commandCounts[frame.kind] = (commandCounts[frame.kind] ?? 0) + 1;
  return {
    schemaVersion: 1,
    sha256,
    bytes,
    header: {
      stamp: result.header.stamp,
      demoProtocol: result.header.demoProtocol,
      networkProtocol: result.header.networkProtocol,
      mapName: result.header.mapName,
      gameDirectory: result.header.gameDirectory,
      playbackTimeSeconds: result.header.playbackTimeSeconds,
      playbackTicks: result.header.playbackTicks,
      playbackFrames: result.header.playbackFrames,
      signonLength: result.header.signonLength,
    },
    headerLabelSha256: {
      serverName: createHash("sha256")
        .update(result.header.serverName)
        .digest("hex"),
      clientName: createHash("sha256")
        .update(result.header.clientName)
        .digest("hex"),
    },
    commandCounts: Object.fromEntries(
      Object.entries(commandCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    commandSequenceSha256: createHash("sha256")
      .update(
        result.frames
          .map((frame) => `${frame.tick ?? "null"}\t${frame.kind}\n`)
          .join(""),
      )
      .digest("hex"),
    issues: result.issues,
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
  };
};

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
