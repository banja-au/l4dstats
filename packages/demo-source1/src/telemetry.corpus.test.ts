import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { visitL4d2EntityFrames } from "./telemetry";

const corpusRoot = resolve("../../data/sprint-1-corpus/extracted");

function findDemos(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory()
        ? findDemos(path)
        : entry.isFile() && entry.name.endsWith(".dem")
          ? [path]
          : [];
    })
    .sort();
}

describe.runIf(existsSync(corpusRoot))("real entity telemetry", () => {
  it("reconstructs every PacketEntities frame across all ten demos", () => {
    const summaries = findDemos(corpusRoot).map((path) => {
      const bytes = readFileSync(path);
      return {
        demoSha256: createHash("sha256").update(bytes).digest("hex"),
        ...visitL4d2EntityFrames(bytes),
      };
    });
    expect(summaries).toHaveLength(10);
    expect(
      summaries.reduce(
        (total, { packetEntityFrames }) => total + packetEntityFrames,
        0,
      ),
    ).toBe(104_183);
    expect(
      summaries.every(
        ({ firstEngineTick, lastEngineTick, maximumTerrorPlayers }) =>
          firstEngineTick !== null &&
          lastEngineTick !== null &&
          lastEngineTick >= firstEngineTick &&
          maximumTerrorPlayers >= 8,
      ),
    ).toBe(true);
    console.info("Source 1 redacted entity reconstruction coverage", summaries);
  }, 120_000);
});
