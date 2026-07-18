import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveCompetitiveStats,
  deriveSurvivorAmmoTraces,
  deriveSurvivorHealthTraces,
  deriveSurvivorLoadoutTraces,
} from "./evidence-bundle";
import { prepareNativeDemoProjection } from "./native-demo-provider";

const corpusDemo = resolve(
  "../../data/sprint-1-corpus/extracted/901780_c2m1_highway/901780_c2m1_highway.dem",
);
describe.runIf(existsSync(corpusDemo))("real Survivor health traces", () => {
  it("compresses observed health and buffer state without losing damage changes", async () => {
    const bytes = readFileSync(corpusDemo);
    const prepared = await prepareNativeDemoProjection(bytes, {
      pseudonymKey: "health-trace-native-fixture-key",
    });
    const projected = prepared.observations.slice(0, 20_000);
    const participantIds = new Set(
      projected.map((row) => row.observation.playerEpochId),
    );
    const traces = deriveSurvivorHealthTraces({
      projected,
      participantIds,
      aliases: new Map(),
      tickIntervalSeconds: 1 / 30,
    });
    expect(traces).toHaveLength(4);
    expect(traces.every((trace) => trace.healthCoverage === 1)).toBe(true);
    expect(traces.every((trace) => trace.bufferCoverage === 1)).toBe(true);
    expect(traces.every((trace) => trace.points.length < 1_000)).toBe(true);
    expect(
      traces.some((trace) => trace.points.some((point) => point.health < 50)),
    ).toBe(true);
    const aliases = new Map(
      [...participantIds].map((id) => [id, id.slice(0, 8)] as const),
    );
    const competitive = deriveCompetitiveStats({
      projected,
      matchStates: [],
      timeline: [],
      aliases,
      playbackTicks: projected.at(-1)?.observation.tick ?? 0,
      tickIntervalSeconds: 1 / 30,
    });
    const summaries = competitive.halves.flatMap((half) =>
      half.players.map((player) => player.summary),
    );
    expect(summaries.length).toBeGreaterThanOrEqual(4);
    expect(summaries.some((summary) => summary.durationSeconds > 0)).toBe(true);
    expect(summaries.every((summary) => summary.observedTeamRate > 0)).toBe(
      true,
    );
    const loadouts = deriveSurvivorLoadoutTraces({
      projected,
      participantIds,
      aliases,
      tickIntervalSeconds: 1 / 30,
    });
    expect(loadouts).toHaveLength(4);
    expect(loadouts.every((trace) => trace.coverage.primaryWeapon === 1)).toBe(
      true,
    );
    expect(
      loadouts.some((trace) =>
        trace.points.some(
          (point) => point.primaryWeapon?.category === "primary",
        ),
      ),
    ).toBe(true);
    expect(
      loadouts.some((trace) =>
        trace.points.some(
          (point) => point.temporaryHealth?.name === "Pain Pills",
        ),
      ),
    ).toBe(true);
    const ammo = deriveSurvivorAmmoTraces({
      projected,
      participantIds,
      aliases,
      tickIntervalSeconds: 1 / 30,
    });
    expect(ammo).toHaveLength(4);
    expect(ammo.every((trace) => trace.coverage > 0.9)).toBe(true);
    expect(ammo.every((trace) => trace.points.length < 1_000)).toBe(true);
    expect(
      ammo.some((trace) =>
        trace.points.some(
          (point) => point.clip !== undefined && point.reserve !== undefined,
        ),
      ),
    ).toBe(true);
  }, 30_000);
});
