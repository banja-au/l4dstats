import { describe, expect, it } from "vitest";
import {
  EntityReconstructor,
  decodePacketEntityData,
  type ClassBaseline,
  type PacketEntityUpdate,
} from "./entities";

const envelope = (
  overrides: Partial<{
    isDelta: boolean;
    deltaFrom: number | null;
    baseline: 0 | 1;
    updateBaseline: boolean;
    maxEntries: number;
  }> = {},
) => ({
  isDelta: false,
  deltaFrom: null,
  baseline: 0 as 0 | 1,
  updateBaseline: false,
  maxEntries: 32,
  ...overrides,
});

const enter = (
  entityIndex: number,
  serial: number,
  value: number,
): PacketEntityUpdate => ({
  entityIndex,
  kind: "enter",
  classId: 7,
  serial,
  properties: [{ index: 1, path: "health", value }],
});

const delta = (entityIndex: number, value: number): PacketEntityUpdate => ({
  entityIndex,
  kind: "delta",
  classId: 7,
  serial: null,
  properties: [{ index: 1, path: "health", value }],
});

const removal = (
  entityIndex: number,
  kind: "leave" | "delete",
): PacketEntityUpdate => ({
  entityIndex,
  kind,
  classId: null,
  serial: null,
  properties: [],
});

describe("packet entity state reconstruction", () => {
  it("applies instance baseline, delta frame and property overlay immutably", () => {
    const baseline: ClassBaseline = {
      classId: 7,
      consumedBits: 1,
      sourceBits: 8,
      properties: [
        { index: 0, path: "team", value: 2 },
        { index: 1, path: "health", value: 100 },
      ],
    };
    const state = new EntityReconstructor({
      instanceBaselines: new Map([[7, baseline]]),
    });
    const first = state.applyPacket(10, envelope(), [enter(3, 4, 90)]);
    const second = state.applyPacket(
      11,
      envelope({ isDelta: true, deltaFrom: 10 }),
      [delta(3, 75)],
    );

    expect([...first.entities.get(3)!.properties]).toEqual([
      ["team", 2],
      ["health", 90],
    ]);
    expect(second.entities.get(3)!.properties.get("health")).toBe(75);
    expect(first.entities.get(3)!.properties.get("health")).toBe(90);
  });

  it("distinguishes leave, resume, delete and a reused serial lifetime", () => {
    const state = new EntityReconstructor();
    const first = state.applyPacket(1, envelope(), [enter(2, 8, 100)]);
    const lifetime = first.entities.get(2)!.lifetime;
    const left = state.applyPacket(
      2,
      envelope({ isDelta: true, deltaFrom: 1 }),
      [removal(2, "leave")],
    );
    expect(left.entities.get(2)!.active).toBe(false);
    const resumed = state.applyPacket(
      3,
      envelope({ isDelta: true, deltaFrom: 2 }),
      [enter(2, 8, 88)],
    );
    expect(resumed.entities.get(2)!.lifetime).toBe(lifetime);
    const deleted = state.applyPacket(
      4,
      envelope({ isDelta: true, deltaFrom: 3 }),
      [removal(2, "delete")],
    );
    expect(deleted.entities.has(2)).toBe(false);
    const replaced = state.applyPacket(
      5,
      envelope({ isDelta: true, deltaFrom: 4 }),
      [enter(2, 9, 77)],
    );
    expect(replaced.entities.get(2)!.lifetime).not.toBe(lifetime);
  });

  it("uses and snapshots the selected dynamic baseline slot", () => {
    const state = new EntityReconstructor();
    state.applyPacket(1, envelope({ baseline: 1, updateBaseline: true }), [
      enter(5, 3, 61),
    ]);
    const restored = state.applyPacket(
      2,
      envelope({ baseline: 0, isDelta: true, deltaFrom: 1 }),
      [{ ...enter(5, 3, 0), properties: [] }],
    );
    expect(restored.entities.get(5)!.properties.get("health")).toBe(61);
  });

  it("rejects missing frames, invalid transitions, duplicates and bounds", () => {
    const state = new EntityReconstructor({ maxEntries: 8, maxHistory: 1 });
    expect(() =>
      state.applyPacket(
        1,
        envelope({ isDelta: true, deltaFrom: 0, maxEntries: 8 }),
        [],
      ),
    ).toThrow(/missing delta frame/);
    expect(() =>
      state.applyPacket(1, envelope({ maxEntries: 8 }), [delta(1, 2)]),
    ).toThrow(/inactive/);
    expect(() =>
      state.applyPacket(2, envelope({ maxEntries: 8 }), [
        enter(1, 1, 2),
        enter(1, 1, 3),
      ]),
    ).toThrow(/duplicate/);
    expect(() => state.applyPacket(3, envelope({ maxEntries: 9 }), [])).toThrow(
      /maximum/,
    );
  });

  it("evicts old source frames at the configured bound", () => {
    const state = new EntityReconstructor({ maxHistory: 1 });
    state.applyPacket(1, envelope(), []);
    state.applyPacket(2, envelope(), []);
    expect(state.getFrame(1)).toBeUndefined();
    expect(() =>
      state.applyPacket(3, envelope({ isDelta: true, deltaFrom: 1 }), []),
    ).toThrow(/missing delta frame/);
  });
});

describe("L4D2 explicit entity deletions", () => {
  it("decodes the >=2091 UBitVar count and delta-coded indexes", () => {
    // UBitVar count=1, then UBitVar delta=18: index starts at -1, so deletes 17.
    const bytes = Uint8Array.of(0x81, 0x14);
    expect(
      decodePacketEntityData(bytes, 0, [], new Map(), {
        explicitDeletionList: true,
        isDelta: true,
        dataBitLength: 16,
        maxEntries: 32,
      }),
    ).toEqual([
      {
        entityIndex: 17,
        kind: "delete",
        classId: null,
        serial: null,
        properties: [],
      },
    ]);
  });

  it("rejects truncated and out-of-range explicit deletions", () => {
    expect(() =>
      decodePacketEntityData(Uint8Array.of(1), 0, [], new Map(), {
        explicitDeletionList: true,
        isDelta: true,
        dataBitLength: 6,
      }),
    ).toThrow(/truncated/);
    expect(() =>
      decodePacketEntityData(Uint8Array.of(0x81, 0x01), 0, [], new Map(), {
        explicitDeletionList: true,
        isDelta: true,
        dataBitLength: 12,
        maxEntries: 5,
      }),
    ).toThrow(/exceeds/);
  });

  it("rejects explicit deletion decoding on a non-delta packet", () => {
    expect(() =>
      decodePacketEntityData(Uint8Array.of(0), 0, [], new Map(), {
        explicitDeletionList: true,
        isDelta: false,
        dataBitLength: 6,
      }),
    ).toThrow(/require a delta packet/);
  });
});
