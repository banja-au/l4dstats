import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeDemo } from "./decode";
import { inspectNetworkPayload } from "./network";

const corpusRoot = resolve("../../data/sprint-1-corpus/extracted");

describe.runIf(readdirSafe(corpusRoot).length > 0)(
  "quarantined network-message corpus",
  () => {
    it("traverses every protocol-2100 message stream without guessing", () => {
      const counts = new Map<string, number>();
      const stops = new Map<string, number>();
      const stopReasons = new Map<string, number>();
      let completePayloads = 0;
      for (const directory of readdirSafe(corpusRoot)) {
        const demo = readdirSafe(join(corpusRoot, directory)).find((name) =>
          name.endsWith(".dem"),
        );
        if (!demo) continue;
        for (const frame of decodeDemo(
          readFileSync(join(corpusRoot, directory, demo)),
        ).frames) {
          if (!frame.payload || !["signon", "packet"].includes(frame.kind))
            continue;
          const inspection = inspectNetworkPayload(frame.payload);
          if (inspection.complete) completePayloads += 1;
          for (const message of inspection.messages) {
            if (message.status === "decoded-boundary")
              counts.set(message.name, (counts.get(message.name) ?? 0) + 1);
            else {
              const key = `${message.status}:${message.name}`;
              stops.set(key, (stops.get(key) ?? 0) + 1);
              if (message.reason) {
                const reasonKey = `${key}:${message.reason}`;
                stopReasons.set(
                  reasonKey,
                  (stopReasons.get(reasonKey) ?? 0) + 1,
                );
              }
            }
          }
        }
      }

      const redacted = Object.fromEntries([...counts].sort());
      console.info("Source 1 bounded network envelope coverage", {
        completePayloads,
        messages: redacted,
        stops: Object.fromEntries([...stops].sort()),
        stopReasons: Object.fromEntries([...stopReasons].sort()),
      });
      expect(completePayloads).toBeGreaterThanOrEqual(104_213);
      expect(stops.size).toBe(0);
      expect(counts.get("svc_PacketEntities")).toBeGreaterThanOrEqual(104_183);
      expect(counts.get("svc_CreateStringTable")).toBeGreaterThanOrEqual(170);
      expect(counts.get("svc_UpdateStringTable")).toBeGreaterThanOrEqual(198);
    }, 60_000);
  },
);

function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
