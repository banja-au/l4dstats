import { describe, expect, it } from "vitest";
import { readNativeAlignmentArtifact } from "./native-demo-alignment";

function artifact(rows: unknown[]): Record<string, unknown> {
  return {
    version: 2,
    header: { mapName: "c1m1_hotel" },
    projection: { observations: { rows } },
  };
}

describe("native demo alignment artifact", () => {
  it("extracts only observed finite positions from frozen compact rows", () => {
    const value = readNativeAlignmentArtifact(
      artifact([
        [0, 1, 1, [1, 2, 3], null, null, null, null, [], []],
        [0, 2, 1, null, null, null, null, null, [], []],
      ]),
    );
    expect(value).toEqual({
      mapName: "c1m1_hotel",
      positions: [{ x: 1, y: 2, z: 3 }],
    });
  });

  it("rejects malformed rows and non-finite coordinates", () => {
    expect(() => readNativeAlignmentArtifact(artifact([[0]]))).toThrow("row 0");
    expect(() =>
      readNativeAlignmentArtifact(
        artifact([
          [0, 1, 1, [1, Number.NaN, 3], null, null, null, null, [], []],
        ]),
      ),
    ).toThrow("invalid position");
  });

  it("rejects incompatible versions and missing map identity", () => {
    expect(() =>
      readNativeAlignmentArtifact({ ...artifact([]), version: 1 }),
    ).toThrow("version");
    expect(() =>
      readNativeAlignmentArtifact({
        version: 2,
        header: {},
        projection: { observations: { rows: [] } },
      }),
    ).toThrow("mapName");
  });
});
