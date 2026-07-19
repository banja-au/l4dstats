import { describe, expect, it } from "vitest";
import type { MatchTimelineEvent } from "./api";
import { buildScreenPointIndex, spatialSubjectPlayerId } from "./spatial-map";

const event = (type: MatchTimelineEvent["type"]): MatchTimelineEvent => ({
  type,
  tick: 10,
  timeSeconds: 1,
  detail: type,
  actorPlayerId: "actor",
  victimPlayerId: "victim",
  subjectPlayerId: "subject",
  position: { x: 1, y: 2, z: 3 },
});

describe("spatialSubjectPlayerId", () => {
  it.each(["death", "incap"] as const)(
    "attributes %s coordinates to the victim",
    (type) => expect(spatialSubjectPlayerId(event(type))).toBe("victim"),
  );

  it.each([
    "spawn",
    "attack",
    "tank_control",
    "revive",
    "pin_start",
    "pin_end",
  ] as const)("attributes %s coordinates to the actor", (type) =>
    expect(spatialSubjectPlayerId(event(type))).toBe("actor"),
  );

  it.each([
    "clear",
    "round_start",
    "round_end",
    "team_change",
    "witch_spawn",
    "witch_enrage",
    "witch_burn",
    "witch_end",
  ] as const)("keeps %s coordinates unassigned", (type) =>
    expect(spatialSubjectPlayerId(event(type))).toBeUndefined(),
  );
});

describe("buildScreenPointIndex", () => {
  it("returns the closest marker inside the requested radius", () => {
    const index = buildScreenPointIndex([
      { x: 10, y: 10, index: 0 },
      { x: 18, y: 16, index: 1 },
      { x: 90, y: 90, index: 2 },
    ]);

    expect(index.nearest(17, 15, 12)).toMatchObject({ index: 1 });
    expect(index.nearest(50, 50, 8)).toBeUndefined();
  });

  it("keeps dense pointer queries bounded well below a full 2,000-point scan", () => {
    const points = Array.from({ length: 2_000 }, (_, index) => ({
      x: (index % 50) * 32 + 4,
      y: Math.floor(index / 50) * 32 + 4,
      index,
    }));
    const spatialIndex = buildScreenPointIndex(points, 32);
    const queries = Array.from({ length: 120 }, (_, index) =>
      spatialIndex.nearest((index % 40) * 32 + 5, (index % 30) * 32 + 5, 18),
    );

    expect(
      Math.max(...queries.map((query) => query?.candidatesExamined ?? 0)),
    ).toBeLessThanOrEqual(9);
  });
});
