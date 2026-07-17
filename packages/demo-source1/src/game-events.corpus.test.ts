import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { visitL4d2GameEvents } from "./telemetry";

const corpusRoot = resolve("../../data/sprint-1-corpus/extracted");

describe.runIf(readdirSafe(corpusRoot).length > 0)(
  "quarantined game-event corpus",
  () => {
    it("decodes every event and projects required events with provenance", () => {
      const coverage: Array<{
        readonly demo: string;
        readonly schemas: number;
        readonly events: number;
        readonly required: Readonly<Record<string, number>>;
      }> = [];
      let totalEvents = 0;
      let totalLists = 0;
      let projected = 0;
      for (const directory of readdirSafe(corpusRoot)) {
        const demo = readdirSafe(join(corpusRoot, directory)).find((name) =>
          name.endsWith(".dem"),
        );
        if (!demo) continue;
        const summary = visitL4d2GameEvents(
          readFileSync(join(corpusRoot, directory, demo)),
          ({ required }) => {
            if (!required) return;
            projected += 1;
            for (const field of [
              required.actorUserId,
              required.victimUserId,
              required.attackerUserId,
              required.weapon,
              required.damage,
              required.health,
            ]) {
              if (field.availability === "observed")
                expect(field.provenance?.message).toBe("svc_GameEvent");
              else expect(field.reason).toBeTruthy();
            }
          },
        );
        totalEvents += summary.events;
        totalLists += summary.schemaLists;
        coverage.push({
          demo: directory,
          schemas: summary.schemas,
          events: summary.events,
          required: summary.requiredEvents,
        });
      }
      console.info("Source 1 redacted game-event coverage", coverage);
      expect(coverage.length).toBeGreaterThanOrEqual(10);
      expect(totalLists).toBe(coverage.length);
      expect(totalEvents).toBeGreaterThanOrEqual(1_437);
      expect(projected).toBeGreaterThanOrEqual(424);
      expect(
        coverage.every(({ required }) => (required.player_death ?? 0) > 0),
      ).toBe(true);
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
