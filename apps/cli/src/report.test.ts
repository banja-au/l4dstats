import { describe, expect, it } from "vitest";
import { stableJson, summarizeDemo } from "./report";

describe("stableJson", () => {
  it("sorts object keys recursively and terminates with one newline", () => {
    expect(stableJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    );
  });

  it("omits runtime timing and sensitive recorder names", () => {
    const inspection = summarizeDemo(
      {
        header: {
          stamp: "HL2DEMO",
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
        },
        frames: [],
        issues: [],
        stopped: true,
        bytesConsumed: 1072,
      },
      "a".repeat(64),
      1072,
    );

    expect(stableJson(inspection)).not.toContain("private server label");
    expect(stableJson(inspection)).not.toContain("recorder label");
    expect(stableJson(inspection)).not.toContain("elapsed");
  });
});
