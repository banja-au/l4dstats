import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeDemo } from "./decode";

const corpusRoot = resolve(
  process.cwd(),
  "../../data/sprint-1-corpus/extracted",
);

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

function stableSummary(result: ReturnType<typeof decodeDemo>): unknown {
  return {
    header: result.header,
    stopped: result.stopped,
    bytesConsumed: result.bytesConsumed,
    issues: result.issues,
    commands: result.frames.reduce<Record<string, number>>((counts, frame) => {
      counts[frame.kind] = (counts[frame.kind] ?? 0) + 1;
      return counts;
    }, {}),
    firstTick: result.frames[0]?.tick ?? null,
    lastTick: result.frames.at(-1)?.tick ?? null,
  };
}

describe("quarantined Sprint 1 corpus", () => {
  it.runIf(existsSync(corpusRoot))(
    "frames all ten real demos completely and deterministically",
    () => {
      const paths = findDemos(corpusRoot);
      expect(paths).toHaveLength(10);

      const summaries = paths.map((path) => {
        const bytes = readFileSync(path);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const startedAt = performance.now();
        const first = decodeDemo(bytes);
        const elapsedMilliseconds = performance.now() - startedAt;
        const second = decodeDemo(bytes);
        const firstSummary = stableSummary(first);

        expect(stableSummary(second)).toEqual(firstSummary);
        expect(first.header.demoProtocol).toBe(4);
        expect(first.header.networkProtocol).toBe(2_100);
        expect(first.frames[0]?.kind).toBe("signon");
        expect(first.stopped).toBe(true);
        expect(first.issues).toEqual([]);
        expect(first.bytesConsumed).toBe(bytes.byteLength);

        return {
          sha256,
          bytes: bytes.byteLength,
          frames: first.frames.length,
          elapsedMilliseconds: Math.round(elapsedMilliseconds),
          commands: (firstSummary as { commands: Record<string, number> })
            .commands,
        };
      });

      // Hashes identify inputs without leaking archive names or player identities.
      console.info("Source 1 corpus framing summary", summaries);
    },
    60_000,
  );
});
