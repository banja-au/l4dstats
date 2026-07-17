import { describe, expect, it } from "vitest";
import {
  decodeL4d2ServerInfo,
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
    expect(identifyFirstNetworkMessage(Uint8Array.of(0b1100_0100))).toEqual({
      id: 4,
      name: "net_StringCmd",
    });
    expect(identifyFirstNetworkMessage(Uint8Array.of())).toBeNull();
  });

  it("rejects a non-ServerInfo payload", () => {
    expect(() => decodeL4d2ServerInfo(Uint8Array.of(4))).toThrow(RangeError);
  });
  it("walks known variable-length messages and byte padding", () => {
    const fixture = new Bits()
      .write(4, 6)
      .string("status")
      .write(3, 6)
      .write(12, 32)
      .write(4, 16)
      .write(5, 16)
      .write(25, 6)
      .write(3, 11)
      .write(5, 3)
      .bytes();
    const result = inspectNetworkPayload(fixture);
    expect(result.messages.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 4, status: "decoded-boundary" },
      { id: 3, status: "decoded-boundary" },
      { id: 25, status: "decoded-boundary" },
    ]);
    expect(result.complete).toBe(true);
    expect(result.trailingPaddingBits).toBeLessThan(8);
  });

  it("fails closed at the exact unsupported identifier", () => {
    const result = inspectNetworkPayload(
      new Bits().write(0, 6).write(9, 6).bytes(),
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
        id: 9,
        name: "svc_SendTable",
        startBit: 6,
        endBit: null,
        status: "unsupported",
      },
    ]);
  });

  it("reports truncated known messages without reading out of bounds", () => {
    const result = inspectNetworkPayload(
      new Bits().write(3, 6).write(1, 3).bytes(),
    );
    expect(result.complete).toBe(false);
    expect(result.messages[0]).toMatchObject({
      id: 3,
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
      inspectNetworkPayload(new Bits().write(4, 6).string("ab").bytes(), {
        maxStringBytes: 1,
      }).messages[0]?.status,
    ).toBe("truncated");
  });
});
