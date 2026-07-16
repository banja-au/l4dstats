import type { DemoDecodeResult } from "@witchwatch/demo-source1";

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
  readonly commandCounts: Readonly<Record<string, number>>;
  readonly issues: DemoDecodeResult["issues"];
  readonly telemetryAvailability: {
    readonly playerIdentity: "unavailable";
    readonly gameEvents: "unavailable";
    readonly playerPositions: "unavailable";
    readonly playerEyeAngles: "unavailable";
    readonly weaponAndFire: "unavailable";
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
    commandCounts: Object.fromEntries(
      Object.entries(commandCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    issues: result.issues,
    telemetryAvailability: {
      playerIdentity: "unavailable",
      gameEvents: "unavailable",
      playerPositions: "unavailable",
      playerEyeAngles: "unavailable",
      weaponAndFire: "unavailable",
      userCommands: "unavailable-for-sourcetv",
    },
    limitations: [
      "Network messages, send tables, string tables, entity deltas and game events are not decoded yet.",
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
