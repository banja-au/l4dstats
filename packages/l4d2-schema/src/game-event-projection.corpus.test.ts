import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { projectL4d2GameEvents } from "./game-event-projection";

const corpusRoot = resolve("../../data/sprint-1-corpus/extracted");

describe.runIf(readdirSafe(corpusRoot).length > 0)(
  "quarantined canonical game-event corpus",
  () => {
    it("streams all required real events as observation schema v1", () => {
      let emitted = 0;
      let decoded = 0;
      for (const directory of readdirSafe(corpusRoot)) {
        const name = readdirSafe(join(corpusRoot, directory)).find((value) =>
          value.endsWith(".dem"),
        );
        if (!name) continue;
        const bytes = readFileSync(join(corpusRoot, directory, name));
        const demoSha256 = createHash("sha256").update(bytes).digest("hex");
        const result = projectL4d2GameEvents(bytes, {
          demoSha256,
          onEvent: ({ observation, identities }) => {
            emitted += 1;
            expect(observation.schemaVersion).toBe(1);
            expect(observation.demoSha256).toBe(demoSha256);
            expect(observation.name).toBe("player_death");
            expect(identities.victim.playerEpochId.availability).toBe(
              "unavailable",
            );
          },
        });
        decoded += result.coverage.decodedEvents;
      }
      expect(decoded).toBeGreaterThanOrEqual(1_437);
      expect(emitted).toBeGreaterThanOrEqual(424);
    });
  },
);

function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
