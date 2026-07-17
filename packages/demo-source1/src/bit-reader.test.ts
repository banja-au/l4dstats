import { describe, expect, it } from "vitest";
import { BitReadError, BitReader } from "./bit-reader";

describe("BitReader", () => {
  it("reads Source-style least-significant-bit-first fields across bytes", () => {
    const reader = new BitReader(Uint8Array.of(0b1010_0101, 0b0000_0011));
    expect(reader.readBits(3)).toBe(5);
    expect(reader.readBits(7)).toBe(116);
    expect(reader.remainingBits).toBe(6);
  });

  it("reads unaligned null-terminated strings", () => {
    // One prefix bit followed by the unaligned bytes 0x20, 0x41, 0x00.
    const bytes = Uint8Array.of(0b0100_0000, 0b1000_0010, 0, 0);
    const reader = new BitReader(bytes);
    reader.skipBits(1);
    expect(reader.readNullTerminatedString(8)).toBe(" A");
  });

  it("fails without advancing on invalid and truncated reads", () => {
    const reader = new BitReader(Uint8Array.of(1));
    expect(() => reader.readBits(9)).toThrow(BitReadError);
    expect(reader.bitOffset).toBe(0);
    expect(() => reader.readBits(33)).toThrow(
      expect.objectContaining({ code: "INVALID_LENGTH" }),
    );
  });

  it("bounds unterminated strings", () => {
    const reader = new BitReader(Uint8Array.of(65, 66, 0));
    expect(() => reader.readNullTerminatedString(2)).toThrow(
      expect.objectContaining({ code: "INVALID_LENGTH" }),
    );
  });
});
