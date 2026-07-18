export interface MapVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MapMeshCoverage {
  readonly worldFaces: number;
  readonly emittedFaces: number;
  readonly emittedTriangles: number;
  readonly skippedToolFaces: number;
  readonly skippedDisplacements: number;
  readonly emittedDisplacements: number;
  readonly rejectedFaces: number;
  readonly staticProps: "unavailable";
  readonly dynamicState: "unavailable";
  readonly compression: {
    readonly codec: "valve-source-lzma1";
    readonly decoder: "@napi-rs/lzma@1.5.1";
    readonly decodedLumps: readonly number[];
    readonly decodedBytes: number;
  };
}

export interface SourceMapMesh {
  readonly format: "witchwatch-map-mesh-v1";
  readonly bspVersion: number;
  readonly mapRevision: number;
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  /** Rounded triangle centroid heights for deterministic client-side floor slicing. */
  readonly triangleZ: readonly number[];
  readonly bounds: { readonly min: MapVector3; readonly max: MapVector3 };
  readonly coverage: MapMeshCoverage;
}

export interface BspParseLimits {
  readonly maxBytes: number;
  readonly maxVertices: number;
  readonly maxEdges: number;
  readonly maxSurfEdges: number;
  readonly maxFaces: number;
  readonly maxTriangles: number;
}

export const defaultBspParseLimits: BspParseLimits = {
  maxBytes: 768 * 1024 * 1024,
  maxVertices: 2_000_000,
  maxEdges: 4_000_000,
  maxSurfEdges: 8_000_000,
  maxFaces: 1_000_000,
  maxTriangles: 4_000_000,
};

const HEADER_BYTES = 4 + 4 + 64 * 16 + 4;
const LUMP_VERTEXES = 3,
  LUMP_TEXINFO = 6,
  LUMP_FACES = 7,
  LUMP_EDGES = 12,
  LUMP_SURFEDGES = 13,
  LUMP_MODELS = 14;
const LUMP_DISPINFO = 26,
  LUMP_DISP_VERTS = 33;
const SURF_SKY2D = 0x2,
  SURF_SKY = 0x4,
  SURF_NODRAW = 0x80;

interface Lump {
  readonly offset: number;
  readonly length: number;
  readonly version: number;
  readonly fourCC: number;
  readonly data: Uint8Array;
  readonly view: DataView;
}

const VALVE_LZMA_HEADER_BYTES = 17;
const REQUIRED_LUMPS = new Set([
  LUMP_VERTEXES,
  LUMP_TEXINFO,
  LUMP_FACES,
  LUMP_EDGES,
  LUMP_SURFEDGES,
  LUMP_MODELS,
  LUMP_DISPINFO,
  LUMP_DISP_VERTS,
]);

function fail(message: string): never {
  throw new RangeError(`invalid Source BSP: ${message}`);
}

function checkedCount(
  lump: Lump,
  stride: number,
  maximum: number,
  name: string,
) {
  if (lump.length % stride !== 0) fail(`${name} lump has a partial element`);
  const count = lump.length / stride;
  if (count > maximum) fail(`${name} count exceeds limit`);
  return count;
}

/**
 * Decode Valve's 17-byte Source wrapper by converting its raw LZMA1 payload
 * into the standard 13-byte .lzma container accepted by the pinned decoder.
 * All declared sizes and the dictionary are bounded before native decoding.
 */
function decodeValveLzmaLump(
  compressed: Uint8Array,
  directorySize: number,
  maximum: number,
  index: number,
): Uint8Array {
  if (compressed.byteLength < VALVE_LZMA_HEADER_BYTES)
    fail(`compressed lump ${index} has a truncated LZMA header`);
  const header = new DataView(
    compressed.buffer,
    compressed.byteOffset,
    compressed.byteLength,
  );
  if (String.fromCharCode(...compressed.subarray(0, 4)) !== "LZMA")
    fail(`compressed lump ${index} has an invalid LZMA signature`);
  const actualSize = header.getUint32(4, true);
  const payloadSize = header.getUint32(8, true);
  const dictionarySize = header.getUint32(13, true);
  if (actualSize !== directorySize)
    fail(`compressed lump ${index} size disagrees with its directory`);
  if (actualSize > maximum)
    fail(`compressed lump ${index} decoded size exceeds limit`);
  if (payloadSize !== compressed.byteLength - VALVE_LZMA_HEADER_BYTES)
    fail(`compressed lump ${index} payload size is invalid`);
  if (dictionarySize === 0 || dictionarySize > maximum)
    fail(`compressed lump ${index} dictionary size exceeds limit`);

  const container = new Uint8Array(13 + payloadSize);
  container.set(compressed.subarray(12, 17), 0);
  const containerView = new DataView(container.buffer);
  containerView.setBigUint64(5, BigInt(actualSize), true);
  container.set(compressed.subarray(17), 13);
  let decoded: Uint8Array;
  try {
    decoded = lzma.decompressSync(container);
  } catch {
    fail(`compressed lump ${index} contains corrupt LZMA data`);
  }
  if (decoded.byteLength !== actualSize)
    fail(`compressed lump ${index} decoded to an unexpected size`);
  return decoded;
}

/**
 * Decode only renderable world-brush geometry. The implementation is independent
 * and deliberately excludes textures, entities, pakfiles and executable content.
 */
export function parseSourceBspWorldMesh(
  bytes: Uint8Array,
  limits: BspParseLimits = defaultBspParseLimits,
): SourceMapMesh {
  if (bytes.byteLength > limits.maxBytes) fail("file exceeds byte limit");
  if (bytes.byteLength < HEADER_BYTES) fail("truncated header");
  const sourceView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "VBSP")
    fail("missing VBSP signature");
  const bspVersion = sourceView.getInt32(4, true);
  if (bspVersion !== 20 && bspVersion !== 21)
    fail(`unsupported version ${bspVersion}`);
  const lumps: Lump[] = [];
  for (let i = 0; i < 64; i++) {
    const base = 8 + i * 16;
    // L4D2's BSP v21 writes the lump version before its file range. Older
    // Source BSPs use the conventional offset, length, version ordering.
    const offset = sourceView.getInt32(
        base + (bspVersion === 21 ? 4 : 0),
        true,
      ),
      length = sourceView.getInt32(base + (bspVersion === 21 ? 8 : 4), true),
      version = sourceView.getInt32(base + (bspVersion === 21 ? 0 : 8), true),
      fourCC = sourceView.getUint32(base + 12, true);
    if (offset < 0 || length < 0 || offset > bytes.byteLength - length)
      fail(`lump ${i} is out of bounds`);
    const data = bytes.subarray(offset, offset + length);
    lumps.push({
      offset,
      length,
      version,
      fourCC,
      data,
      view: new DataView(data.buffer, data.byteOffset, data.byteLength),
    });
  }
  const occupied = lumps
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.length > 0)
    .sort((a, b) => a.offset - b.offset || a.index - b.index);
  for (let i = 1; i < occupied.length; i++) {
    const previous = occupied[i - 1],
      current = occupied[i];
    if (
      previous &&
      current &&
      current.offset < previous.offset + previous.length
    )
      fail(`lumps ${previous.index} and ${current.index} overlap`);
  }
  let decodedBytes = 0;
  const decodedLumps: number[] = [];
  const lump = (index: number) => {
    const entry = lumps[index] ?? fail(`missing lump ${index}`);
    if (!REQUIRED_LUMPS.has(index) || entry.fourCC === 0) return entry;
    if (entry.length === 0) fail(`compressed lump ${index} has no payload`);
    const data = decodeValveLzmaLump(
      entry.data,
      entry.fourCC,
      limits.maxBytes - decodedBytes,
      index,
    );
    decodedBytes += data.byteLength;
    decodedLumps.push(index);
    return {
      ...entry,
      offset: 0,
      length: data.byteLength,
      data,
      view: new DataView(data.buffer, data.byteOffset, data.byteLength),
    };
  };
  const vertexLump = lump(LUMP_VERTEXES),
    edgeLump = lump(LUMP_EDGES),
    surfEdgeLump = lump(LUMP_SURFEDGES),
    faceLump = lump(LUMP_FACES),
    texInfoLump = lump(LUMP_TEXINFO),
    modelLump = lump(LUMP_MODELS);
  const dispInfoLump = lump(LUMP_DISPINFO),
    dispVertLump = lump(LUMP_DISP_VERTS);
  const vertexCount = checkedCount(
    vertexLump,
    12,
    limits.maxVertices,
    "vertex",
  );
  const edgeCount = checkedCount(edgeLump, 4, limits.maxEdges, "edge");
  const surfEdgeCount = checkedCount(
    surfEdgeLump,
    4,
    limits.maxSurfEdges,
    "surfedge",
  );
  const faceCount = checkedCount(faceLump, 56, limits.maxFaces, "face");
  const texInfoCount = checkedCount(
    texInfoLump,
    72,
    limits.maxFaces,
    "texinfo",
  );
  const modelCount = checkedCount(modelLump, 48, 65_536, "model");
  const dispInfoCount = checkedCount(
    dispInfoLump,
    176,
    limits.maxFaces,
    "dispinfo",
  );
  const dispVertCount = checkedCount(
    dispVertLump,
    20,
    limits.maxVertices,
    "dispvert",
  );
  if (modelCount === 0) fail("world model is missing");
  const firstFace = modelLump.view.getInt32(40, true);
  const worldFaces = modelLump.view.getInt32(44, true);
  if (firstFace < 0 || worldFaces < 0 || firstFace > faceCount - worldFaces)
    fail("world model face range is invalid");

  const vertices: MapVector3[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const point = {
      x: vertexLump.view.getFloat32(i * 12, true),
      y: vertexLump.view.getFloat32(i * 12 + 4, true),
      z: vertexLump.view.getFloat32(i * 12 + 8, true),
    };
    if (![point.x, point.y, point.z].every(Number.isFinite))
      fail("non-finite vertex");
    vertices.push(point);
  }
  const positions: number[] = [],
    indices: number[] = [];
  let emittedFaces = 0,
    skippedToolFaces = 0,
    skippedDisplacements = 0,
    emittedDisplacements = 0,
    rejectedFaces = 0;
  for (
    let faceIndex = firstFace;
    faceIndex < firstFace + worldFaces;
    faceIndex++
  ) {
    const at = faceIndex * 56;
    const surfStart = faceLump.view.getInt32(at + 4, true),
      edgeTotal = faceLump.view.getUint16(at + 8, true),
      texInfo = faceLump.view.getInt16(at + 10, true),
      dispInfo = faceLump.view.getInt16(at + 12, true);
    if (
      texInfo < 0 ||
      texInfo >= texInfoCount ||
      edgeTotal < 3 ||
      surfStart < 0 ||
      surfStart > surfEdgeCount - edgeTotal
    ) {
      rejectedFaces++;
      continue;
    }
    const flags = texInfoLump.view.getInt32(texInfo * 72 + 64, true);
    if ((flags & (SURF_SKY2D | SURF_SKY | SURF_NODRAW)) !== 0) {
      skippedToolFaces++;
      continue;
    }
    const polygon: MapVector3[] = [];
    let valid = true;
    for (let j = 0; j < edgeTotal; j++) {
      const signedEdge = surfEdgeLump.view.getInt32((surfStart + j) * 4, true);
      const edgeIndex = Math.abs(signedEdge);
      if (edgeIndex >= edgeCount) {
        valid = false;
        break;
      }
      const edgeAt = edgeIndex * 4;
      const vertexIndex = edgeLump.view.getUint16(
        edgeAt + (signedEdge < 0 ? 2 : 0),
        true,
      );
      const point = vertices[vertexIndex];
      if (!point) {
        valid = false;
        break;
      }
      polygon.push(point);
    }
    if (dispInfo >= 0) {
      if (!valid || dispInfo >= dispInfoCount || polygon.length !== 4) {
        skippedDisplacements++;
        rejectedFaces++;
        continue;
      }
      const infoAt = dispInfo * 176;
      const start = {
          x: dispInfoLump.view.getFloat32(infoAt, true),
          y: dispInfoLump.view.getFloat32(infoAt + 4, true),
          z: dispInfoLump.view.getFloat32(infoAt + 8, true),
        },
        dispVertStart = dispInfoLump.view.getInt32(infoAt + 12, true),
        power = dispInfoLump.view.getInt32(infoAt + 20, true);
      if (
        ![start.x, start.y, start.z].every(Number.isFinite) ||
        power < 2 ||
        power > 4
      ) {
        skippedDisplacements++;
        rejectedFaces++;
        continue;
      }
      const side = 2 ** power + 1,
        needed = side * side,
        triangleTotal = (side - 1) * (side - 1) * 2;
      if (
        dispVertStart < 0 ||
        dispVertStart > dispVertCount - needed ||
        indices.length / 3 + triangleTotal > limits.maxTriangles
      ) {
        if (indices.length / 3 + triangleTotal > limits.maxTriangles)
          fail("triangle count exceeds limit");
        skippedDisplacements++;
        rejectedFaces++;
        continue;
      }
      let startCorner = 0,
        closest = Infinity;
      for (let corner = 0; corner < 4; corner++) {
        const point = polygon[corner];
        if (!point) continue;
        const squared =
          (point.x - start.x) ** 2 +
          (point.y - start.y) ** 2 +
          (point.z - start.z) ** 2;
        if (squared < closest) {
          closest = squared;
          startCorner = corner;
        }
      }
      const corners = Array.from(
        { length: 4 },
        (_, offset) => polygon[(startCorner + offset) % 4],
      );
      if (corners.some((point) => !point)) {
        skippedDisplacements++;
        rejectedFaces++;
        continue;
      }
      const [a, b, c, d] = corners as [
        MapVector3,
        MapVector3,
        MapVector3,
        MapVector3,
      ];
      const base = positions.length / 3;
      for (let row = 0; row < side; row++) {
        const y = row / (side - 1);
        for (let column = 0; column < side; column++) {
          const x = column / (side - 1),
            bottom = {
              x: a.x + (b.x - a.x) * x,
              y: a.y + (b.y - a.y) * x,
              z: a.z + (b.z - a.z) * x,
            },
            top = {
              x: d.x + (c.x - d.x) * x,
              y: d.y + (c.y - d.y) * x,
              z: d.z + (c.z - d.z) * x,
            },
            flat = {
              x: bottom.x + (top.x - bottom.x) * y,
              y: bottom.y + (top.y - bottom.y) * y,
              z: bottom.z + (top.z - bottom.z) * y,
            },
            dispAt = (dispVertStart + row * side + column) * 20,
            vector = {
              x: dispVertLump.view.getFloat32(dispAt, true),
              y: dispVertLump.view.getFloat32(dispAt + 4, true),
              z: dispVertLump.view.getFloat32(dispAt + 8, true),
            },
            distance = dispVertLump.view.getFloat32(dispAt + 12, true);
          if (![vector.x, vector.y, vector.z, distance].every(Number.isFinite))
            fail("non-finite displacement vertex");
          positions.push(
            flat.x + vector.x * distance,
            flat.y + vector.y * distance,
            flat.z + vector.z * distance,
          );
        }
      }
      for (let row = 0; row < side - 1; row++) {
        for (let column = 0; column < side - 1; column++) {
          const lowerLeft = base + row * side + column,
            lowerRight = lowerLeft + 1,
            upperLeft = lowerLeft + side,
            upperRight = upperLeft + 1;
          indices.push(
            lowerLeft,
            upperLeft,
            upperRight,
            lowerLeft,
            upperRight,
            lowerRight,
          );
        }
      }
      emittedFaces++;
      emittedDisplacements++;
      continue;
    }
    const triangleTotal = polygon.length - 2;
    if (!valid || indices.length / 3 + triangleTotal > limits.maxTriangles) {
      if (indices.length / 3 + Math.max(0, triangleTotal) > limits.maxTriangles)
        fail("triangle count exceeds limit");
      rejectedFaces++;
      continue;
    }
    const base = positions.length / 3;
    for (const point of polygon) positions.push(point.x, point.y, point.z);
    for (let j = 1; j < polygon.length - 1; j++)
      indices.push(base, base + j, base + j + 1);
    emittedFaces++;
  }
  if (positions.length === 0) fail("no supported world geometry was emitted");
  const min = { x: Infinity, y: Infinity, z: Infinity },
    max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i] ?? Infinity);
    min.y = Math.min(min.y, positions[i + 1] ?? Infinity);
    min.z = Math.min(min.z, positions[i + 2] ?? Infinity);
    max.x = Math.max(max.x, positions[i] ?? -Infinity);
    max.y = Math.max(max.y, positions[i + 1] ?? -Infinity);
    max.z = Math.max(max.z, positions[i + 2] ?? -Infinity);
  }
  const triangleZ: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    let height = 0;
    for (let corner = 0; corner < 3; corner++) {
      const positionIndex = (indices[index + corner] ?? 0) * 3 + 2;
      height += positions[positionIndex] ?? 0;
    }
    triangleZ.push(Math.round((height / 3) * 16) / 16);
  }
  return {
    format: "witchwatch-map-mesh-v1",
    bspVersion,
    mapRevision: sourceView.getInt32(8 + 64 * 16, true),
    positions,
    indices,
    triangleZ,
    bounds: { min, max },
    coverage: {
      worldFaces,
      emittedFaces,
      emittedTriangles: indices.length / 3,
      skippedToolFaces,
      skippedDisplacements,
      emittedDisplacements,
      rejectedFaces,
      staticProps: "unavailable",
      dynamicState: "unavailable",
      compression: {
        codec: "valve-source-lzma1",
        decoder: "@napi-rs/lzma@1.5.1",
        decodedLumps,
        decodedBytes,
      },
    },
  };
}
import { lzma } from "@napi-rs/lzma";
