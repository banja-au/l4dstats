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

export function defineTelemetryCorpusShard(shard: number, shardCount: number) {
  describe.runIf(existsSync(corpusRoot))(
    `real entity telemetry shard ${shard + 1}/${shardCount}`,
    () => {
      const paths = findDemos(corpusRoot);
      if (shard === 0) {
        it("retains the original golden corpus minimum", () => {
          expect(paths.length).toBeGreaterThanOrEqual(10);
        });
      }
      const shardPaths = paths.filter(
        (_, index) => index % shardCount === shard,
      );
      it.each(shardPaths)(
        "reconstructs PacketEntities for %s",
        (path) => {
          const bytes = readFileSync(path);
          const summary = {
            demoSha256: createHash("sha256").update(bytes).digest("hex"),
            ...visitL4d2EntityFrames(bytes),
          };
          expect(summary.packetEntityFrames).toBeGreaterThan(0);
          expect(summary.firstEngineTick).not.toBeNull();
          expect(summary.lastEngineTick).not.toBeNull();
          expect(summary.lastEngineTick!).toBeGreaterThanOrEqual(
            summary.firstEngineTick!,
          );
          expect(summary.maximumTerrorPlayers).toBeGreaterThanOrEqual(8);
          console.info(
            "Source 1 redacted entity reconstruction coverage",
            summary,
          );
        },
        120_000,
      );
    },
  );
}
