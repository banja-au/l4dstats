import type {
  EntityFrameVisit,
  EntitySnapshot,
  FlattenedServerClass,
} from "@witchwatch/demo-source1";
import { describe, expect, it } from "vitest";

import { L4d2PlayerProjector } from "./entity-projection";

const hash = "a".repeat(64);
const classes = [
  {
    className: "CTerrorPlayer",
    dataTableId: 0,
    dataTableName: "DT_TerrorPlayer",
    props: [],
  },
  {
    className: "CWeaponRifle",
    dataTableId: 1,
    dataTableName: "DT_WeaponRifle",
    props: [],
  },
] satisfies readonly FlattenedServerClass[];

function entity(
  entityIndex: number,
  classId: number,
  lifetime: number,
  properties: Readonly<Record<string, number | readonly number[]>> = {},
): EntitySnapshot {
  return {
    entityIndex,
    classId,
    serial: lifetime,
    lifetime,
    active: true,
    properties: new Map(Object.entries(properties)),
  };
}

function frame(
  tick: number,
  entities: readonly EntitySnapshot[],
): EntityFrameVisit {
  return {
    demoTick: tick,
    engineTick: tick,
    classes,
    frame: {
      sequence: tick,
      entities: new Map(entities.map((value) => [value.entityIndex, value])),
    },
  };
}

describe("L4D2 player entity projection", () => {
  it("binds a reused slot to the identity effective for each lifetime", () => {
    const projector = new L4d2PlayerProjector({
      demoSha256: hash,
      userInfo: [
        {
          entityIndex: 2,
          userInfoSlot: 1,
          effectiveTick: 180,
        },
        {
          entityIndex: 2,
          userInfoSlot: 1,
          userId: 10,
          stableIdentityToken: "first",
          effectiveTick: 100,
        },
        {
          entityIndex: 2,
          userInfoSlot: 1,
          userId: 20,
          stableIdentityToken: "second",
          effectiveTick: 200,
        },
      ],
    });
    projector.visit(frame(150, [entity(2, 0, 1)]));
    projector.visit(frame(175, []));
    projector.visit(frame(190, [entity(2, 0, 2)]));
    projector.visit(frame(195, []));
    projector.visit(frame(225, [entity(2, 0, 3)]));
    expect(projector.finish().playerEpochs).toMatchObject([
      {
        userId: { value: 10 },
        steamId: { value: "first" },
        disconnectedAtTick: { value: 175 },
      },
      {
        userId: { availability: "unavailable" },
        steamId: { availability: "unavailable" },
        disconnectedAtTick: { value: 195 },
      },
      { userId: { value: 20 }, steamId: { value: "second" } },
    ]);
  });
  it("streams complete network properties with explicit provenance", () => {
    const output: unknown[] = [];
    const projector = new L4d2PlayerProjector({
      demoSha256: hash,
      tickIntervalSeconds: 0.03,
      userInfo: [
        {
          entityIndex: 2,
          userInfoSlot: 1,
          userId: 7,
          stableIdentityToken: "sha256:privacy-safe-token",
        },
      ],
      onObservation: (value) => output.push(value),
    });
    projector.visit(
      frame(100, [
        entity(2, 0, 5, {
          "DT_TerrorPlayer.m_vecOrigin": [10, 20],
          "DT_LocalPlayer.m_vecOrigin[2]": 30,
          "DT_TerrorPlayer.m_angEyeAngles[0]": 4,
          "DT_TerrorPlayer.m_angEyeAngles[1]": 90,
          "DT_TerrorPlayer.m_angEyeAngles[2]": 1,
          "DT_BaseEntity.m_iTeamNum": 2,
          "DT_TerrorPlayer.m_zombieClass": 3,
          "DT_BaseCombatCharacter.m_hActiveWeapon": 12,
        }),
        entity(12, 1, 9),
      ]),
    );
    const result = projector.finish();

    expect(output).toMatchObject([
      {
        observation: {
          tick: 100,
          demoTimeSeconds: { availability: "derived", value: 3 },
          position: {
            availability: "observed",
            value: { x: 10, y: 20, z: 30 },
          },
          eyeAngles: {
            availability: "observed",
            value: { pitch: 4, yaw: 90, roll: 1 },
          },
          team: { availability: "observed", value: 2 },
          playerClass: { availability: "observed", value: "zombie-class:3" },
          weapon: { availability: "observed", value: "CWeaponRifle" },
          buttons: { availability: "unavailable" },
        },
        provenance: {
          position: { source: "network-send-property" },
          demoTimeSeconds: { source: "derived-engine-tick" },
          buttons: { source: "unavailable" },
        },
      },
    ]);
    expect(result.playerEpochs).toMatchObject([
      {
        id: `${hash}:2:5`,
        userId: { availability: "observed", value: 7 },
        steamId: {
          availability: "observed",
          value: "sha256:privacy-safe-token",
        },
      },
    ]);
    expect(result.coverage).toMatchObject({
      framesVisited: 1,
      observationsEmitted: 1,
      fieldAvailability: {
        position: { observed: 1, derived: 0, unavailable: 0 },
        buttons: { observed: 0, derived: 0, unavailable: 1 },
      },
    });
  });

  it("keeps partial properties unavailable instead of manufacturing zeroes", () => {
    const output: Array<{
      observation: { position: unknown; eyeAngles: unknown; weapon: unknown };
    }> = [];
    const projector = new L4d2PlayerProjector({
      demoSha256: hash,
      userInfo: [],
      onObservation: (value) => output.push(value),
    });
    projector.visit(
      frame(5, [
        entity(3, 0, 1, {
          m_vecOrigin: [1, 2],
          "m_angEyeAngles[0]": 10,
          "m_angEyeAngles[1]": 20,
          m_hActiveWeapon: 99,
        }),
      ]),
    );

    expect(output[0]?.observation).toMatchObject({
      position: {
        availability: "unavailable",
        reason: expect.stringContaining("XYZ"),
      },
      eyeAngles: {
        availability: "derived",
        value: { pitch: 10, yaw: 20, roll: 0 },
      },
      weapon: {
        availability: "unavailable",
        reason: expect.stringContaining("did not resolve"),
      },
    });
    expect(output[0]).toMatchObject({
      provenance: {
        eyeAngles: {
          source: "derived-network-normalization",
          reason: expect.stringContaining("explicitly normalized"),
        },
      },
    });
  });

  it("closes and replaces epochs when an entity slot lifetime changes", () => {
    const projector = new L4d2PlayerProjector({
      demoSha256: hash,
      userInfo: [],
    });
    projector.visit(frame(10, [entity(2, 0, 1)]));
    projector.visit(frame(20, [entity(2, 0, 2)]));
    projector.visit(frame(30, []));
    expect(projector.finish().playerEpochs).toMatchObject([
      {
        id: `${hash}:2:1`,
        connectedAtTick: 10,
        disconnectedAtTick: { value: 20 },
      },
      {
        id: `${hash}:2:2`,
        connectedAtTick: 20,
        disconnectedAtTick: { value: 30 },
      },
    ]);
  });

  it("rejects ambiguous identity mappings", () => {
    expect(
      () =>
        new L4d2PlayerProjector({
          demoSha256: hash,
          userInfo: [
            { entityIndex: 2, userInfoSlot: 1 },
            { entityIndex: 2, userInfoSlot: 2 },
          ],
        }),
    ).toThrow(/duplicate userinfo mapping/);
  });
});
