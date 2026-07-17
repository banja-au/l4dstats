import { describe, expect, it } from "vitest";
import { decodeL4d2DataTables } from "./data-tables";

describe("L4D2 data tables", () => {
  it("fails closed on truncated schemas", () =>
    expect(() => decodeL4d2DataTables(Uint8Array.of(1))).toThrow());
  it("accepts an empty bounded schema", () =>
    expect(decodeL4d2DataTables(Uint8Array.of(0, 0, 0))).toMatchObject({
      tables: [],
      serverClasses: [],
    }));
});
