import { describe, expect, it } from "vitest";
import {
  decodeCreateStringTableEnvelope,
  decodeL4d2ServerInfo,
  decodeUpdateStringTableEnvelope,
  extractNetworkBits,
  identifyFirstNetworkMessage,
  inspectNetworkPayload,
} from "./network";

class Bits {
  readonly values: number[] = [];
  write(value: number, width: number): this {
    for (let bit = 0; bit < width; bit += 1)
      this.values.push((value >>> bit) & 1);
    return this;
  }
  string(value: string): this {
    for (const byte of new TextEncoder().encode(`${value}\0`))
      this.write(byte, 8);
    return this;
  }
  bytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.values.length / 8));
    this.values.forEach((value, bit) => {
      const index = bit >>> 3;
      bytes[index] = bytes[index]! | (value << (bit & 7));
    });
    return bytes;
  }
}

describe("inspectNetworkPayload", () => {
  it("identifies only the authoritative first six-bit message ID", () => {
    expect(identifyFirstNetworkMessage(Uint8Array.of(0b1100_0101))).toEqual({
      id: 5,
      name: "net_StringCmd",
    });
    expect(identifyFirstNetworkMessage(Uint8Array.of())).toBeNull();
  });

  it("rejects a non-ServerInfo payload", () => {
    expect(() => decodeL4d2ServerInfo(Uint8Array.of(4))).toThrow(RangeError);
  });
  it("walks known variable-length messages and byte padding", () => {
    const fixture = new Bits()
      .write(5, 6)
      .string("status")
      .write(4, 6)
      .write(12, 32)
      .write(4, 16)
      .write(5, 16)
      .write(25, 6)
      .write(3, 11)
      .write(5, 3)
      .bytes();
    const result = inspectNetworkPayload(fixture);
    expect(result.messages.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 5, status: "decoded-boundary" },
      { id: 4, status: "decoded-boundary" },
      { id: 25, status: "decoded-boundary" },
    ]);
    expect(result.complete).toBe(true);
    expect(result.trailingPaddingBits).toBeLessThan(8);
    const event = result.messages[2]!.envelope;
    expect(event?.kind).toBe("game-event");
    if (event?.kind === "game-event") {
      expect(event.value.dataBitLength).toBe(3);
      expect(extractNetworkBits(fixture, event.value.dataStartBit, 3)).toEqual(
        Uint8Array.of(5),
      );
    }
  });

  it("exposes the bounded game-event-list payload", () => {
    const fixture = new Bits()
      .write(30, 6)
      .write(2, 9)
      .write(4, 20)
      .write(11, 4)
      .bytes();
    const result = inspectNetworkPayload(fixture);
    const list = result.messages[0]!.envelope;
    expect(list?.kind).toBe("game-event-list");
    if (list?.kind === "game-event-list") {
      expect(list.value.eventCount).toBe(2);
      expect(list.value.dataBitLength).toBe(4);
      expect(extractNetworkBits(fixture, list.value.dataStartBit, 4)).toEqual(
        Uint8Array.of(11),
      );
    }
  });

  it("walks create/update string-table and packet-entity envelopes", () => {
    const fixture = new Bits()
      .write(12, 6)
      .string("modelprecache")
      .write(32, 16)
      .write(2, 6)
      .write(3, 21)
      .write(1, 1)
      .write(8, 12)
      .write(3, 4)
      .write(1, 2)
      .write(5, 3)
      .write(13, 6)
      .write(4, 5)
      .write(1, 1)
      .write(2, 16)
      .write(2, 20)
      .write(3, 2)
      .write(26, 6)
      .write(2_047, 11)
      .write(0, 1)
      .write(0, 1)
      .write(1, 11)
      .write(1, 20)
      .write(0, 1)
      .write(1, 1)
      .bytes();

    const result = inspectNetworkPayload(fixture);
    expect(result.complete).toBe(true);
    expect(result.messages.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 12, status: "decoded-boundary" },
      { id: 13, status: "decoded-boundary" },
      { id: 26, status: "decoded-boundary" },
    ]);
    const packet = result.messages[2]!.envelope;
    expect(packet?.kind).toBe("packet-entities");
    if (packet?.kind === "packet-entities") {
      expect(
        extractNetworkBits(
          fixture,
          packet.value.dataStartBit,
          packet.value.dataBitLength,
        ),
      ).toEqual(Uint8Array.of(1));
    }
  });

  it("reports bounded string-table envelope metadata", () => {
    const create = new Bits()
      .write(12, 6)
      .string("userinfo")
      .write(32, 16)
      .write(3, 6)
      .write(2, 21)
      .write(0, 1)
      .write(0, 2)
      .write(3, 2)
      .bytes();
    expect(decodeCreateStringTableEnvelope(create)).toEqual({
      tableName: "userinfo",
      maxEntries: 32,
      entryCount: 3,
      dataBitLength: 2,
      dataStartBit: 124,
      userDataFixedSize: false,
      userDataSize: null,
      userDataSizeBits: null,
      isFilenames: false,
      flags: 0,
      dataCompressed: false,
    });

    const update = new Bits()
      .write(13, 6)
      .write(7, 5)
      .write(0, 1)
      .write(3, 20)
      .write(5, 3)
      .bytes();
    expect(decodeUpdateStringTableEnvelope(update)).toEqual({
      tableId: 7,
      changedEntries: 1,
      dataBitLength: 3,
      dataStartBit: 32,
    });
  });

  it("fails closed at the exact unsupported identifier", () => {
    const result = inspectNetworkPayload(
      new Bits().write(0, 6).write(34, 6).bytes(),
    );
    expect(result.complete).toBe(false);
    expect(result.messages).toEqual([
      {
        id: 0,
        name: "net_NOP",
        startBit: 0,
        endBit: 6,
        status: "decoded-boundary",
      },
      {
        id: 34,
        name: "unknown_34",
        startBit: 6,
        endBit: null,
        status: "unsupported",
      },
    ]);
  });

  it("reports truncated known messages without reading out of bounds", () => {
    const result = inspectNetworkPayload(
      new Bits().write(4, 6).write(1, 3).bytes(),
    );
    expect(result.complete).toBe(false);
    expect(result.messages[0]).toMatchObject({
      id: 4,
      status: "truncated",
      startBit: 0,
    });
  });

  it("enforces resource limits", () => {
    expect(() =>
      inspectNetworkPayload(new Bits().write(0, 6).write(0, 6).bytes(), {
        maxMessages: 1,
      }),
    ).toThrow(RangeError);
    expect(
      inspectNetworkPayload(new Bits().write(5, 6).string("ab").bytes(), {
        maxStringBytes: 1,
      }).messages[0]?.status,
    ).toBe("truncated");
    expect(
      inspectNetworkPayload(
        new Bits()
          .write(13, 6)
          .write(0, 5)
          .write(0, 1)
          .write(9, 20)
          .write(0, 9)
          .bytes(),
        { maxMessageDataBits: 8 },
      ).messages[0]?.status,
    ).toBe("malformed");
  });
});
