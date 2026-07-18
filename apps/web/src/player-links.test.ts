import { describe, expect, it } from "vitest";
import { parsePlayerProfilePath, playerProfilePath } from "./player-links";

describe("player profile routes", () => {
  it("round trips opaque game and player identifiers", () => {
    const path = playerProfilePath("game/a", "anonymous:4 / epoch");
    expect(path).toBe("/game/game%2Fa/player/anonymous%3A4%20%2F%20epoch");
    expect(parsePlayerProfilePath(path)).toEqual({
      gameId: "game/a",
      playerId: "anonymous:4 / epoch",
    });
  });

  it("does not confuse game tabs with player profiles", () => {
    expect(parsePlayerProfilePath("/game/id/players")).toBeNull();
    expect(parsePlayerProfilePath("/analysis/id/player/123")).toBeNull();
    expect(parsePlayerProfilePath("/game/id/player/%E0%A4%A")).toBeNull();
  });
});
