import { describe, expect, it } from "vitest";
import { PlayerEpochTracker, unavailable } from "./index";

describe("PlayerEpochTracker", () => {
  it("does not confuse a reused entity slot with the prior player", () => {
    const tracker = new PlayerEpochTracker("a".repeat(64));
    const first = tracker.connect({
      entitySlot: 2,
      tick: 10,
      steamId: "STEAM_1:1:1",
      userId: 7,
    });
    const second = tracker.connect({
      entitySlot: 2,
      tick: 20,
      steamId: "STEAM_1:1:2",
      userId: 8,
    });
    expect(second.id).not.toBe(first.id);
    expect(tracker.finish()).toEqual([
      expect.objectContaining({
        id: first.id,
        disconnectedAtTick: { availability: "observed", value: 20 },
      }),
      expect.objectContaining({
        id: second.id,
        disconnectedAtTick: {
          availability: "unavailable",
          reason: expect.any(String),
        },
      }),
    ]);
  });

  it("represents missing values explicitly", () => {
    expect(unavailable("not in POV demo")).toEqual({
      availability: "unavailable",
      reason: "not in POV demo",
    });
  });
});
