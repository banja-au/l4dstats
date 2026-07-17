import { describe, expect, it } from "vitest";
import { BitReader } from "./bit-reader";
import type { FlattenedSendProp } from "./data-tables";
import {
  decodePacketEntitiesEnvelope,
  decodePropertyStream,
  readPropertyIndexes,
} from "./entities";

class Bits {
  readonly values: number[] = [];
  write(value: number, count: number): this {
    for (let bit = 0; bit < count; bit += 1)
      this.values.push((value >>> bit) & 1);
    return this;
  }
  bytes(): Uint8Array {
    const result = new Uint8Array(Math.ceil(this.values.length / 8));
    this.values.forEach((value, bit) => {
      const byte = bit >>> 3;
      result[byte] = result[byte]! | (value << (bit & 7));
    });
    return result;
  }
}

const integerProp = (path: string): FlattenedSendProp => ({
  path,
  arrayElement: null,
  prop: {
    type: 0,
    name: path,
    flags: 1,
    priority: 0,
    dataTableName: null,
    lowValue: 0,
    highValue: 255,
    bitCount: 8,
    arrayElements: null,
  },
});

describe("Source 1 entity streams", () => {
  it("decodes bounded new-way property indexes and values", () => {
    const bits = new Bits()
      .write(1, 1) // new way
      .write(1, 1) // index 0
      .write(0, 1)
      .write(1, 1)
      .write(2, 3) // index 3
      .write(0, 1)
      .write(0, 1)
      .write(31, 5)
      .write(3, 2)
      .write(127, 7) // 4095 terminator
      .write(17, 8)
      .write(42, 8);
    expect(
      decodePropertyStream(new BitReader(bits.bytes()), [
        integerProp("a"),
        integerProp("b"),
        integerProp("c"),
        integerProp("d"),
      ]),
    ).toEqual([
      { index: 0, path: "a", value: 17 },
      { index: 3, path: "d", value: 42 },
    ]);
  });

  it("rejects a property index outside the flattened class", () => {
    const bits = new Bits().write(1, 1).write(0, 1).write(1, 1).write(7, 3);
    expect(() => readPropertyIndexes(new BitReader(bits.bytes()), 2)).toThrow(
      /outside/,
    );
  });

  it("extracts a bounded packet-entities envelope", () => {
    const bits = new Bits()
      .write(26, 6)
      .write(2_047, 11)
      .write(1, 1)
      .write(123, 32)
      .write(1, 1)
      .write(1, 11)
      .write(3, 20)
      .write(0, 1)
      .write(5, 3);
    expect(decodePacketEntitiesEnvelope(bits.bytes())).toMatchObject({
      maxEntries: 2_047,
      isDelta: true,
      deltaFrom: 123,
      baseline: 1,
      updatedEntries: 1,
      dataBitLength: 3,
      updateBaseline: false,
      data: Uint8Array.of(5),
    });
  });
});
