import { describe, expect, it } from "vitest";
import { numberHitsByObservedRounds } from "./story-timeline";

describe("numberHitsByObservedRounds", () => {
  it("restarts hit numbering at each observed round start", () => {
    const numbers = numberHitsByObservedRounds(
      [
        { id: "r2-hit-2", startTick: 260 },
        { id: "r1-hit-1", startTick: 120 },
        { id: "r2-hit-1", startTick: 220 },
      ],
      [100, 200],
    );
    expect(numbers.get("r1-hit-1")).toEqual({
      round: 1,
      hit: 1,
      observedBoundary: true,
    });
    expect(numbers.get("r2-hit-1")).toEqual({
      round: 2,
      hit: 1,
      observedBoundary: true,
    });
    expect(numbers.get("r2-hit-2")?.hit).toBe(2);
  });

  it("keeps pre-boundary hits explicitly unsegmented", () => {
    const numbers = numberHitsByObservedRounds(
      [
        { id: "before", startTick: 50 },
        { id: "after", startTick: 110 },
      ],
      [100],
    );
    expect(numbers.get("before")).toEqual({
      round: 0,
      hit: 1,
      observedBoundary: false,
    });
    expect(numbers.get("after")).toEqual({
      round: 1,
      hit: 1,
      observedBoundary: true,
    });
  });
});
