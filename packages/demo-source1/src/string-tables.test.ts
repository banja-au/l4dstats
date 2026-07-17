import { describe, expect, it } from "vitest";
import {
  decodeL4d2UserInfo,
  decodeStringTableSnapshot,
  decodeStringTableSnapshotWithDiagnostics,
} from "./string-tables";

class Bits {
  values: number[] = [];
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
    const out = new Uint8Array(Math.ceil(this.values.length / 8));
    this.values.forEach((v, b) => {
      const i = b >>> 3;
      out[i] = out[i]! | (v << (b & 7));
    });
    return out;
  }
}

describe("demo string table snapshots", () => {
  it("decodes unaligned entries and optional data", () => {
    const fixture = new Bits()
      .write(1, 8)
      .string("userinfo")
      .write(1, 16)
      .string("0")
      .write(1, 1)
      .write(2, 16)
      .write(7, 8)
      .write(8, 8)
      .write(0, 1)
      .bytes();
    expect(decodeStringTableSnapshot(fixture).tables).toEqual([
      {
        name: "userinfo",
        entries: [{ name: "0", data: Uint8Array.of(7, 8) }],
        clientEntries: [],
      },
    ]);
    expect(
      decodeStringTableSnapshotWithDiagnostics(fixture).boundaries,
    ).toEqual([
      {
        tableIndex: 0,
        tableName: "userinfo",
        section: "server",
        entryIndex: 0,
        entryName: "0",
        entryStartBit: 96,
        dataStartBit: 129,
        dataLengthBytes: 2,
        entryEndBit: 145,
      },
    ]);
    expect(
      decodeStringTableSnapshotWithDiagnostics(fixture).snapshot.consumedBits,
    ).toBe(146);
  });

  it("fails closed on truncation and limits", () => {
    expect(() => decodeStringTableSnapshot(Uint8Array.of(1))).toThrow();
    expect(() =>
      decodeStringTableSnapshot(Uint8Array.of(2), { maxTables: 1 }),
    ).toThrow(RangeError);
  });

  it("extracts stable identity fields without exposing names", () => {
    const data = new Uint8Array(140);
    const view = new DataView(data.buffer);
    view.setBigUint64(0, 76561198000000000n, true);
    view.setInt32(40, 42, true);
    data[116] = 1;
    expect(decodeL4d2UserInfo(data)).toEqual({
      steamId64: 76561198000000000n,
      userId: 42,
      fakePlayer: true,
      sourceBytes: 140,
    });
  });
});
