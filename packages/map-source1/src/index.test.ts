import { lzma } from "@napi-rs/lzma";
import { describe, expect, it } from "vitest";
import { parseSourceBspWorldMesh } from "./index.js";

const HEADER = 4 + 4 + 64 * 16 + 4;

function fixture(
  options: {
    signature?: string;
    faceEdges?: number;
    displacement?: boolean;
  } = {},
) {
  const chunks = [
    { lump: 3, stride: 12, count: 4 },
    { lump: 6, stride: 72, count: 1 },
    { lump: 7, stride: 56, count: 1 },
    { lump: 12, stride: 4, count: 4 },
    { lump: 13, stride: 4, count: 4 },
    { lump: 14, stride: 48, count: 1 },
    ...(options.displacement
      ? [
          { lump: 26, stride: 176, count: 1 },
          { lump: 33, stride: 20, count: 25 },
        ]
      : []),
  ];
  const total =
    HEADER + chunks.reduce((sum, item) => sum + item.stride * item.count, 0);
  const bytes = new Uint8Array(total),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(options.signature ?? "VBSP"));
  view.setInt32(4, 21, true);
  let offset = HEADER;
  for (const chunk of chunks) {
    const at = 8 + chunk.lump * 16;
    // Exact L4D2 v21 order: version, offset, length, fourCC.
    view.setInt32(at, 0, true);
    view.setInt32(at + 4, offset, true);
    view.setInt32(at + 8, chunk.stride * chunk.count, true);
    offset += chunk.stride * chunk.count;
  }
  const at = (lump: number) => view.getInt32(8 + lump * 16 + 4, true);
  [
    [0, 0, 0],
    [10, 0, 0],
    [10, 20, 0],
    [0, 20, 0],
  ].forEach((point, i) =>
    point.forEach((value, axis) =>
      view.setFloat32(at(3) + i * 12 + axis * 4, value, true),
    ),
  );
  const face = at(7);
  view.setInt32(face + 4, 0, true);
  view.setUint16(face + 8, options.faceEdges ?? 4, true);
  view.setInt16(face + 10, 0, true);
  view.setInt16(face + 12, options.displacement ? 0 : -1, true);
  for (let i = 0; i < 4; i++) {
    view.setUint16(at(12) + i * 4, i, true);
    view.setUint16(at(12) + i * 4 + 2, (i + 1) % 4, true);
    view.setInt32(at(13) + i * 4, i, true);
  }
  view.setInt32(at(14) + 40, 0, true);
  view.setInt32(at(14) + 44, 1, true);
  if (options.displacement) {
    view.setFloat32(at(26), 0, true);
    view.setFloat32(at(26) + 4, 0, true);
    view.setFloat32(at(26) + 8, 0, true);
    view.setInt32(at(26) + 12, 0, true);
    view.setInt32(at(26) + 20, 2, true);
    for (let i = 0; i < 25; i++) view.setFloat32(at(33) + i * 20 + 8, 1, true);
  }
  view.setInt32(8 + 64 * 16, 7, true);
  return bytes;
}

function compressLump(bytes: Uint8Array, lump: number): Uint8Array {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerAt = 8 + lump * 16;
  const offset = source.getInt32(headerAt + 4, true);
  const length = source.getInt32(headerAt + 8, true);
  const encoded = lzma.compressSync(bytes.subarray(offset, offset + length));
  const payload = encoded.subarray(13);
  const wrapper = new Uint8Array(17 + payload.byteLength);
  const wrapperView = new DataView(wrapper.buffer);
  wrapper.set(new TextEncoder().encode("LZMA"));
  wrapperView.setUint32(4, length, true);
  wrapperView.setUint32(8, payload.byteLength, true);
  wrapper.set(encoded.subarray(0, 5), 12);
  wrapper.set(payload, 17);

  const delta = wrapper.byteLength - length;
  const result = new Uint8Array(bytes.byteLength + delta);
  result.set(bytes.subarray(0, offset));
  result.set(wrapper, offset);
  result.set(bytes.subarray(offset + length), offset + wrapper.byteLength);
  const resultView = new DataView(result.buffer);
  for (let index = 0; index < 64; index++) {
    const at = 8 + index * 16;
    const originalOffset = source.getInt32(at + 4, true);
    if (originalOffset > offset)
      resultView.setInt32(at + 4, originalOffset + delta, true);
  }
  resultView.setInt32(headerAt + 8, wrapper.byteLength, true);
  resultView.setUint32(headerAt + 12, length, true);
  return result;
}

describe("Source BSP world mesh", () => {
  it("triangulates a generated world face without proprietary fixtures", () => {
    expect(parseSourceBspWorldMesh(fixture())).toMatchObject({
      format: "witchwatch-map-mesh-v1",
      bspVersion: 21,
      mapRevision: 7,
      indices: [0, 1, 2, 0, 2, 3],
      triangleZ: [0, 0],
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 0 } },
      coverage: {
        worldFaces: 1,
        emittedFaces: 1,
        emittedTriangles: 2,
        staticProps: "unavailable",
        compression: {
          codec: "valve-source-lzma1",
          decodedLumps: [],
          decodedBytes: 0,
        },
      },
    });
  });

  it.each([
    ["signature", () => fixture({ signature: "NOPE" }), "signature"],
    ["face range", () => fixture({ faceEdges: 30 }), "geometry"],
  ])("fails closed for an invalid %s", (_name, make, message) =>
    expect(() => parseSourceBspWorldMesh(make())).toThrow(message),
  );

  it("enforces allocation limits before decoding", () => {
    expect(() =>
      parseSourceBspWorldMesh(fixture(), {
        maxBytes: 10,
        maxVertices: 1,
        maxEdges: 1,
        maxSurfEdges: 1,
        maxFaces: 1,
        maxTriangles: 1,
      }),
    ).toThrow("byte limit");
  });

  it("reconstructs a bounded power-two displacement grid", () => {
    const mesh = parseSourceBspWorldMesh(fixture({ displacement: true }));
    expect(mesh.positions).toHaveLength(25 * 3);
    expect(mesh.indices).toHaveLength(32 * 3);
    expect(mesh.coverage).toMatchObject({
      emittedDisplacements: 1,
      skippedDisplacements: 0,
      emittedTriangles: 32,
      rejectedFaces: 0,
    });
  });

  it("rejects overlapping non-empty lump ranges", () => {
    const bytes = fixture(),
      view = new DataView(bytes.buffer);
    const vertexOffset = view.getInt32(8 + 3 * 16 + 4, true);
    view.setInt32(8 + 6 * 16 + 4, vertexOffset + 4, true);
    expect(() => parseSourceBspWorldMesh(bytes)).toThrow("overlap");
  });

  it("decodes a valid Valve Source LZMA compressed lump", () => {
    const mesh = parseSourceBspWorldMesh(compressLump(fixture(), 3));
    expect(mesh.bounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 20, z: 0 },
    });
    expect(mesh.coverage.compression).toEqual({
      codec: "valve-source-lzma1",
      decoder: "@napi-rs/lzma@1.5.1",
      decodedLumps: [3],
      decodedBytes: 48,
    });
  });

  it.each([
    [
      "truncated header",
      (bytes: Uint8Array, _offset: number) =>
        new DataView(bytes.buffer).setInt32(8 + 3 * 16 + 8, 16, true),
      "truncated LZMA header",
    ],
    [
      "signature",
      (bytes: Uint8Array, offset: number) => bytes.fill(0, offset, offset + 4),
      "invalid LZMA signature",
    ],
    [
      "payload length",
      (bytes: Uint8Array, offset: number) =>
        new DataView(bytes.buffer).setUint32(offset + 8, 1, true),
      "payload size is invalid",
    ],
    [
      "directory size",
      (bytes: Uint8Array, _offset: number) =>
        new DataView(bytes.buffer).setUint32(8 + 3 * 16 + 12, 47, true),
      "size disagrees",
    ],
  ])("rejects a malformed compressed lump %s", (_name, mutate, message) => {
    const bytes = compressLump(fixture(), 3);
    const offset = new DataView(bytes.buffer).getInt32(8 + 3 * 16 + 4, true);
    mutate(bytes, offset);
    expect(() => parseSourceBspWorldMesh(bytes)).toThrow(message);
  });

  it("rejects a decoded-size bomb before invoking the decoder", () => {
    const bytes = compressLump(fixture(), 3);
    const view = new DataView(bytes.buffer);
    const offset = view.getInt32(8 + 3 * 16 + 4, true);
    const bombSize = bytes.byteLength + 1;
    view.setUint32(offset + 4, bombSize, true);
    view.setUint32(8 + 3 * 16 + 12, bombSize, true);
    expect(() =>
      parseSourceBspWorldMesh(bytes, {
        maxBytes: bytes.byteLength,
        maxVertices: 2_000_000,
        maxEdges: 4_000_000,
        maxSurfEdges: 8_000_000,
        maxFaces: 1_000_000,
        maxTriangles: 4_000_000,
      }),
    ).toThrow("decoded size exceeds limit");
  });

  it("rejects corrupt compressed data without exposing decoder errors", () => {
    const bytes = compressLump(fixture(), 3);
    const view = new DataView(bytes.buffer);
    const offset = view.getInt32(8 + 3 * 16 + 4, true);
    bytes.fill(0, offset + 17);
    expect(() => parseSourceBspWorldMesh(bytes)).toThrow(
      "contains corrupt LZMA data",
    );
  });
});
