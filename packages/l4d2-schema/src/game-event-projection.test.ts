import type { PlayerEpoch } from "@witchwatch/contracts";
import type {
  DecodedGameEvent,
  EventFieldAvailability,
  GameEventVisit,
  RequiredGameEventProjection,
} from "@witchwatch/demo-source1";
import { describe, expect, it, vi } from "vitest";
import { L4d2GameEventProjector } from "./game-event-projection";

const digest = "a".repeat(64);

describe("L4d2GameEventProjector", () => {
  it("emits observation v1 and resolves role user IDs to the active epoch", () => {
    const sink = vi.fn();
    const projector = new L4d2GameEventProjector({
      demoSha256: digest,
      playerEpochs: [
        epoch(7, "attacker", 100, 300),
        epoch(42, "victim", 50, 250),
      ],
      onEvent: sink,
    });
    const result = projector.visit(hurtVisit());
    expect(result?.observation).toEqual({
      schemaVersion: 1,
      demoSha256: digest,
      tick: 200,
      name: "player_hurt",
      fields: { userid: 42, attacker: 7, health: 61, dmg_health: 19 },
    });
    expect(result?.identities.victim.playerEpochId).toEqual({
      availability: "derived",
      value: "victim",
    });
    expect(result?.identities.attacker.playerEpochId).toEqual({
      availability: "derived",
      value: "attacker",
    });
    expect(result?.required.damage.provenance).toEqual({
      message: "svc_GameEvent",
      eventId: 17,
      field: "dmg_health",
    });
    expect(result?.tickProvenance).toBe("net_Tick.engineTick");
    expect(sink).toHaveBeenCalledOnce();
    expect(projector.finish().coverage).toEqual({
      decodedEvents: 1,
      requiredEvents: 1,
      emittedByName: { weapon_fire: 0, player_hurt: 1, player_death: 0 },
      epochJoins: { resolved: 3, unavailable: 0 },
    });
  });

  it("streams only required events and makes failed identity joins explicit", () => {
    const projector = new L4d2GameEventProjector({ demoSha256: digest });
    expect(projector.visit({ ...hurtVisit(), required: null })).toBeNull();
    const result = projector.visit(hurtVisit());
    expect(result?.identities.attacker.playerEpochId).toEqual({
      availability: "unavailable",
      reason: "no player epoch matches this user ID at the event tick",
    });
    expect(projector.finish().coverage).toMatchObject({
      decodedEvents: 2,
      requiredEvents: 1,
      epochJoins: { resolved: 0, unavailable: 3 },
    });
  });

  it("rejects cross-demo epochs and ambiguous overlapping epochs", () => {
    expect(
      () =>
        new L4d2GameEventProjector({
          demoSha256: digest,
          playerEpochs: [
            { ...epoch(7, "wrong", 0, 1), demoSha256: "b".repeat(64) },
          ],
        }),
    ).toThrow("different demo");
    const projector = new L4d2GameEventProjector({
      demoSha256: digest,
      playerEpochs: [epoch(7, "one", 0, 300), epoch(7, "two", 100, 400)],
    });
    expect(
      projector.visit(hurtVisit())?.identities.attacker.playerEpochId,
    ).toEqual({
      availability: "unavailable",
      reason: "multiple player epochs match this user ID at the event tick",
    });
  });
});

function hurtVisit(): GameEventVisit {
  const event: DecodedGameEvent = {
    id: 17,
    name: "player_hurt",
    fields: { userid: 42, attacker: 7, health: 61, dmg_health: 19 },
    schema: {
      id: 17,
      name: "player_hurt",
      fields: [
        { name: "userid", type: "long" },
        { name: "attacker", type: "long" },
        { name: "health", type: "byte" },
        { name: "dmg_health", type: "byte" },
      ],
    },
  };
  const required: RequiredGameEventProjection = {
    name: "player_hurt",
    eventId: 17,
    tick: 200,
    actorUserId: observed(42, 17, "userid"),
    victimUserId: observed(42, 17, "userid"),
    attackerUserId: observed(7, 17, "attacker"),
    weapon: { availability: "unavailable", reason: "schema has no weapon" },
    damage: observed(19, 17, "dmg_health"),
    health: observed(61, 17, "health"),
    decoded: event,
  };
  return { demoTick: 199, engineTick: 200, event, required };
}

function observed<T extends number | string | boolean>(
  value: T,
  eventId: number,
  field: string,
): EventFieldAvailability<T> {
  return {
    availability: "observed",
    value,
    provenance: { message: "svc_GameEvent", eventId, field },
  };
}

function epoch(
  userId: number,
  id: string,
  start: number,
  end: number,
): PlayerEpoch {
  return {
    id,
    demoSha256: digest,
    entitySlot: userId,
    userId: { availability: "observed", value: userId },
    steamId: { availability: "unavailable", reason: "test fixture" },
    connectedAtTick: start,
    disconnectedAtTick: { availability: "observed", value: end },
  };
}
