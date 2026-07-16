import { describe, expect, it } from "vitest";
import { BinaryReader, BinaryReadError } from "./reader";

describe("BinaryReader", () => {
  it("honors Uint8Array views and little-endian values", () => {
    const backing = Uint8Array.of(99, 7, 0x78, 0x56, 0x34, 0x12, 88);
    const reader = new BinaryReader(backing.subarray(1, 6));

    expect(reader.u8()).toBe(7);
    expect(reader.i32()).toBe(0x12345678);
    expect(reader.remaining).toBe(0);
  });

  it("does not advance after an out-of-bounds read", () => {
    const reader = new BinaryReader(Uint8Array.of(1, 2));

    expect(() => reader.i32()).toThrow(
      expect.objectContaining({
        name: "BinaryReadError",
        code: "OUT_OF_BOUNDS",
        offset: 0,
        requestedBytes: 4,
        availableBytes: 2,
      } satisfies Partial<BinaryReadError>),
    );
    expect(reader.offset).toBe(0);
  });

  it("rejects invalid lengths", () => {
    const reader = new BinaryReader(Uint8Array.of());
    expect(() => reader.bytes(-1)).toThrow(
      expect.objectContaining({ code: "INVALID_LENGTH" }),
    );
    expect(() => reader.bytes(Number.MAX_VALUE)).toThrow(
      expect.objectContaining({ code: "INVALID_LENGTH" }),
    );
  });

  it("decodes fixed latin-1 strings through the first null", () => {
    const reader = new BinaryReader(Uint8Array.of(0x63, 0xe9, 0, 0x78));
    expect(reader.fixedString(4)).toBe("cé");
  });
});
