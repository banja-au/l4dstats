import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeDemo } from "./decode";
import { decodeL4d2DataTables, flattenServerClasses } from "./data-tables";
import { decodeInstanceBaselines } from "./entities";
import { decodeL4d2ServerInfo, identifyFirstNetworkMessage } from "./network";
import { decodeL4d2UserInfo, decodeStringTableSnapshot } from "./string-tables";

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
    "decodes send-table and 278-class schemas for every demo",
    () => {
      const summaries = findDemos(corpusRoot).map((path) => {
        const d = decodeDemo(readFileSync(path));
        const p = d.frames.find((f) => f.kind === "data-tables")?.payload;
        expect(p).toBeDefined();
        const schema = decodeL4d2DataTables(p!);
        expect(schema.serverClasses).toHaveLength(278);
        expect(schema.tables.length).toBeGreaterThan(100);
        return {
          demoSha256: createHash("sha256")
            .update(readFileSync(path))
            .digest("hex"),
          tables: schema.tables.length,
          props: schema.tables.reduce((n, t) => n + t.props.length, 0),
          classes: schema.serverClasses.length,
        };
      });
      console.info("Source 1 redacted data-table coverage", summaries);
    },
    60_000,
  );
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

  it.runIf(existsSync(corpusRoot))(
    "decodes redacted ServerInfo for every demo",
    () => {
      const summaries = findDemos(corpusRoot).map((path) => {
        const decoded = decodeDemo(readFileSync(path));
        const frame = decoded.frames.find(
          ({ payload }) =>
            payload !== undefined &&
            identifyFirstNetworkMessage(payload)?.id === 8,
        );
        expect(frame?.payload).toBeDefined();
        const info = decodeL4d2ServerInfo(frame!.payload!);
        expect(info.networkProtocol).toBe(2_100);
        expect(info.isSourceTv).toBe(true);
        expect(info.tickIntervalSeconds).toBeGreaterThan(0);
        expect(info.tickIntervalSeconds).toBeLessThan(1);
        return {
          demoSha256: createHash("sha256")
            .update(readFileSync(path))
            .digest("hex"),
          ...info,
        };
      });
      expect(summaries).toHaveLength(10);
      console.info("Source 1 redacted ServerInfo coverage", summaries);
    },
    60_000,
  );

  it.runIf(existsSync(corpusRoot))(
    "reports the first NET/SVC identifier across all ten demos",
    () => {
      const coverage = new Map<string, number>();
      let payloads = 0;
      let emptyPayloads = 0;

      for (const path of findDemos(corpusRoot)) {
        const decoded = decodeDemo(readFileSync(path));
        for (const frame of decoded.frames) {
          if (
            (frame.kind !== "packet" && frame.kind !== "signon") ||
            frame.payload === undefined ||
            frame.payload.byteLength === 0
          )
            continue;
          payloads += 1;
          const first = identifyFirstNetworkMessage(frame.payload);
          if (first === undefined) emptyPayloads += 1;
          else coverage.set(first.name, (coverage.get(first.name) ?? 0) + 1);
        }
      }

      const stableCoverage = Object.fromEntries(
        [...coverage].sort(([left], [right]) => left.localeCompare(right)),
      );
      expect(payloads).toBeGreaterThan(100_000);
      expect(payloads).toBe(
        emptyPayloads +
          Object.values(stableCoverage).reduce((a, b) => a + b, 0),
      );
      // The first six-bit identifier is authoritative. Later boundaries remain
      // experimental until each branch-specific message shape is corpus-proven.
      console.info("Source 1 first NET/SVC identifier coverage", {
        payloads,
        emptyPayloads,
        firstIdentifier: stableCoverage,
      });
    },
    60_000,
  );

  it.runIf(existsSync(corpusRoot))(
    "decodes redacted string-table and userinfo coverage for every demo",
    () => {
      const summaries = findDemos(corpusRoot).map((path) => {
        const decoded = decodeDemo(readFileSync(path));
        const frame = decoded.frames.find(
          ({ kind }) => kind === "string-tables",
        );
        expect(frame?.payload).toBeDefined();
        const snapshot = decodeStringTableSnapshot(frame!.payload!);
        const userinfo = snapshot.tables.find(
          ({ name }) => name === "userinfo",
        );
        const baselines = snapshot.tables.find(
          ({ name }) => name === "instancebaseline",
        );
        const identities = (userinfo?.entries ?? [])
          .filter((entry) => entry.data !== null)
          .map((entry) => decodeL4d2UserInfo(entry.data!));
        expect(snapshot.consumedBits).toBeLessThanOrEqual(
          frame!.payload!.byteLength * 8,
        );
        expect(userinfo).toBeDefined();
        expect(baselines).toBeDefined();
        return {
          demoSha256: createHash("sha256")
            .update(readFileSync(path))
            .digest("hex"),
          tables: snapshot.tables.length,
          userinfoEntries: userinfo!.entries.length,
          identities: identities.length,
          humanIdentities: identities.filter(({ fakePlayer }) => !fakePlayer)
            .length,
          baselineEntries: baselines!.entries.filter(
            ({ data }) => data !== null,
          ).length,
          baselineBytes: baselines!.entries.reduce(
            (total, { data }) => total + (data?.byteLength ?? 0),
            0,
          ),
        };
      });
      expect(summaries).toHaveLength(10);
      expect(summaries.every(({ identities }) => identities > 0)).toBe(true);
      // No names, account IDs, GUIDs, or local paths are printed.
      console.info("Source 1 redacted string-table coverage", summaries);
    },
    60_000,
  );

  it.runIf(existsSync(corpusRoot))(
    "decodes every populated instancebaseline across all ten demos",
    () => {
      const summaries = findDemos(corpusRoot).map((path) => {
        const decoded = decodeDemo(readFileSync(path));
        const dataTables = decoded.frames.find(
          ({ kind }) => kind === "data-tables",
        );
        const stringTables = decoded.frames.find(
          ({ kind }) => kind === "string-tables",
        );
        expect(dataTables?.payload).toBeDefined();
        expect(stringTables?.payload).toBeDefined();

        const classes = flattenServerClasses(
          decodeL4d2DataTables(dataTables!.payload!),
        );
        const baselineTable = decodeStringTableSnapshot(
          stringTables!.payload!,
        ).tables.find(({ name }) => name === "instancebaseline");
        expect(baselineTable).toBeDefined();
        const populated = baselineTable!.entries.filter(
          ({ data }) => data !== null,
        ).length;
        const baselines = decodeInstanceBaselines(baselineTable!, classes);
        expect(baselines.size).toBe(populated);
        expect(
          [...baselines.values()].every(
            ({ consumedBits, sourceBits }) =>
              sourceBits - consumedBits >= 0 && sourceBits - consumedBits <= 7,
          ),
        ).toBe(true);
        return {
          demoSha256: createHash("sha256")
            .update(readFileSync(path))
            .digest("hex"),
          baselines: baselines.size,
          properties: [...baselines.values()].reduce(
            (total, baseline) => total + baseline.properties.length,
            0,
          ),
        };
      });
      expect(summaries).toHaveLength(10);
      console.info("Source 1 redacted baseline coverage", summaries);
    },
    60_000,
  );
});
