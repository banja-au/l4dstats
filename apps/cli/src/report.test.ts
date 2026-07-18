import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectNativeDemo } from "./native-demo-provider";
import { stableJson, summarizeNativeDemo } from "./report";

const corpusDemo = resolve(
  "../../data/sprint-1-corpus/extracted/901780_c2m1_highway/901780_c2m1_highway.dem",
);

describe("stableJson", () => {
  it("sorts object keys recursively and terminates with one newline", () => {
    expect(stableJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    );
  });

  it("omits runtime timing and sensitive recorder names", () => {
    const framing = {
      schemaVersion: 1 as const,
      stamp: "HL2DEMO" as const,
      demoProtocol: 4,
      networkProtocol: 2100,
      serverName: "private server label",
      clientName: "recorder label",
      mapName: "c1m1_hotel",
      gameDirectory: "left4dead2",
      playbackTimeSeconds: 1,
      playbackTicks: 100,
      playbackFrames: 10,
      signonLength: 20,
      frameCount: 0,
      commandCounts: [],
      commandSequenceSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      issues: [],
      stopped: true,
      bytesConsumed: 1072,
    };
    const inspection = summarizeNativeDemo(
      { demoSha256: "a".repeat(64), bytes: 1072 },
      framing,
    );

    expect(stableJson(inspection)).not.toContain("private server label");
    expect(stableJson(inspection)).not.toContain("recorder label");
    expect(stableJson(inspection)).not.toContain("elapsed");
    expect(inspection.telemetryAvailability.playerPositions).toBe(
      "not-evaluated-by-lightweight-inspect",
    );
    expect(inspection.limitations.join(" ")).not.toContain("not decoded yet");
  });
});

it.runIf(existsSync(corpusDemo))(
  "preserves the inspection golden through native framing",
  async () => {
    const bytes = readFileSync(corpusDemo);
    const inspected = await inspectNativeDemo(bytes);
    const result = summarizeNativeDemo(inspected, inspected.framing);
    expect(result.commandSequenceSha256).toBe(
      "4abd60beecccd494fedd825a24a70589718bbeb6ab74592ae2606298fea040fa",
    );
    expect(result.commandCounts).toEqual({
      "data-tables": 1,
      packet: 17337,
      signon: 3,
      stop: 1,
      "string-tables": 1,
      "sync-tick": 1,
    });
    expect(result.header.mapName).toBe("c2m1_highway");
  },
  120_000,
);
