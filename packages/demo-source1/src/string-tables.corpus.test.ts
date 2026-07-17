import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeDemo } from "./decode";
import { decodeStringTableSnapshotWithDiagnostics } from "./string-tables";

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

function extractBits(
  source: Uint8Array,
  startBit: number,
  lengthBytes: number,
): Uint8Array {
  const result = new Uint8Array(lengthBytes);
  for (let outputBit = 0; outputBit < lengthBytes * 8; outputBit += 1) {
    const sourceBit = startBit + outputBit;
    result[outputBit >>> 3] =
      result[outputBit >>> 3]! |
      (((source[sourceBit >>> 3]! >>> (sourceBit & 7)) & 1) << (outputBit & 7));
  }
  return result;
}

describe("quarantined string-table snapshot corpus", () => {
  it.runIf(existsSync(corpusRoot))(
    "proves snapshot entry boundaries across available demos",
    () => {
      const summaries = findDemos(corpusRoot).map((path) => {
        const frame = decodeDemo(readFileSync(path)).frames.find(
          ({ kind }) => kind === "string-tables",
        );
        expect(frame?.payload).toBeDefined();
        const payload = frame!.payload!;
        const { snapshot, boundaries } =
          decodeStringTableSnapshotWithDiagnostics(payload);
        const baselines = snapshot.tables.find(
          ({ name }) => name === "instancebaseline",
        );
        expect(baselines).toBeDefined();
        const baselineBoundaries = boundaries.filter(
          ({ tableName, section }) =>
            tableName === "instancebaseline" && section === "server",
        );
        expect(baselineBoundaries).toHaveLength(baselines!.entries.length);

        for (const boundary of baselineBoundaries) {
          expect(boundary.entryName).toMatch(/^(0|[1-9][0-9]*)$/);
          const entry = baselines!.entries[boundary.entryIndex]!;
          expect(entry.name).toBe(boundary.entryName);
          if (boundary.dataStartBit === null) {
            expect(entry.data).toBeNull();
          } else {
            expect(entry.data).toEqual(
              extractBits(
                payload,
                boundary.dataStartBit,
                boundary.dataLengthBytes,
              ),
            );
            expect(boundary.entryEndBit - boundary.dataStartBit).toBe(
              boundary.dataLengthBytes * 8,
            );
          }
        }
        const remainingBits = payload.byteLength * 8 - snapshot.consumedBits;
        expect(remainingBits).toBeGreaterThanOrEqual(0);
        expect(remainingBits).toBeLessThan(8);
        return {
          entries: baselineBoundaries.length,
          populated: baselineBoundaries.filter(
            ({ dataStartBit }) => dataStartBit !== null,
          ).length,
          unalignedPayloads: baselineBoundaries.filter(
            ({ dataStartBit }) =>
              dataStartBit !== null && dataStartBit % 8 !== 0,
          ).length,
          remainingBits,
        };
      });
      expect(summaries.length).toBeGreaterThanOrEqual(10);
      expect(
        summaries.every(({ unalignedPayloads }) => unalignedPayloads > 0),
      ).toBe(true);
      console.info("Redacted string-table boundary coverage", summaries);
    },
    60_000,
  );
});
