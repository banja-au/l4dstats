import { BitReadError, BitReader } from "./bit-reader.js";
import { uncompress } from "snappyjs";

export interface DemoStringTableEntry {
  readonly name: string;
  readonly data: Uint8Array | null;
}

export interface DemoStringTable {
  readonly name: string;
  readonly entries: readonly DemoStringTableEntry[];
  readonly clientEntries: readonly DemoStringTableEntry[];
}

export interface StringTableSnapshot {
  readonly tables: readonly DemoStringTable[];
  readonly consumedBits: number;
}

/** Bit-boundary metadata for auditing snapshot extraction without retaining payloads. */
export interface StringTableEntryBoundary {
  readonly tableIndex: number;
  readonly tableName: string;
  readonly section: "server" | "client";
  readonly entryIndex: number;
  readonly entryName: string;
  readonly entryStartBit: number;
  readonly dataStartBit: number | null;
  readonly dataLengthBytes: number;
  readonly entryEndBit: number;
}

export interface StringTableSnapshotDiagnostics {
  readonly snapshot: StringTableSnapshot;
  readonly boundaries: readonly StringTableEntryBoundary[];
}

export interface StringTableLimits {
  readonly maxTables?: number;
  readonly maxEntriesPerTable?: number;
  readonly maxStringBytes?: number;
  readonly maxEntryDataBytes?: number;
}

export function decodeStringTableSnapshot(
  payload: Uint8Array,
  limits: StringTableLimits = {},
): StringTableSnapshot {
  return decodeSnapshot(payload, limits, null).snapshot;
}

/**
 * Decodes the same demo-command snapshot while exposing exact bit boundaries.
 *
 * Unlike network string-table messages, the dem_stringtables command has no
 * dictionary, substring, fixed-user-data, or compression flags. Entry data is
 * a 16-bit byte length followed immediately at the current (possibly
 * unaligned) bit position.
 */
export function decodeStringTableSnapshotWithDiagnostics(
  payload: Uint8Array,
  limits: StringTableLimits = {},
): StringTableSnapshotDiagnostics {
  const boundaries: StringTableEntryBoundary[] = [];
  return decodeSnapshot(payload, limits, boundaries);
}

function decodeSnapshot(
  payload: Uint8Array,
  limits: StringTableLimits,
  boundaries: StringTableEntryBoundary[] | null,
): StringTableSnapshotDiagnostics {
  const maxTables = limit(limits.maxTables, 255, "maxTables");
  const maxEntries = limit(
    limits.maxEntriesPerTable,
    65_535,
    "maxEntriesPerTable",
  );
  const maxString = limit(limits.maxStringBytes, 16_384, "maxStringBytes");
  const maxData = limit(
    limits.maxEntryDataBytes,
    1_048_576,
    "maxEntryDataBytes",
  );
  const reader = new BitReader(payload);
  const count = reader.readBits(8);
  if (count > maxTables)
    throw new RangeError(`string table count ${count} exceeds ${maxTables}`);
  const tables: DemoStringTable[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = reader.readNullTerminatedString(maxString);
    const entries = readEntries(
      reader,
      reader.readBits(16),
      maxEntries,
      maxString,
      maxData,
      boundaries,
      index,
      name,
      "server",
    );
    const clientEntries = reader.readBoolean()
      ? readEntries(
          reader,
          reader.readBits(16),
          maxEntries,
          maxString,
          maxData,
          boundaries,
          index,
          name,
          "client",
        )
      : [];
    tables.push({ name, entries, clientEntries });
  }
  return {
    snapshot: { tables, consumedBits: reader.bitOffset },
    boundaries: boundaries ?? [],
  };
}

function readEntries(
  reader: BitReader,
  count: number,
  maxEntries: number,
  maxString: number,
  maxData: number,
  boundaries: StringTableEntryBoundary[] | null,
  tableIndex: number,
  tableName: string,
  section: "server" | "client",
): DemoStringTableEntry[] {
  if (count > maxEntries)
    throw new RangeError(
      `string table entry count ${count} exceeds ${maxEntries}`,
    );
  return Array.from({ length: count }, (_, entryIndex) => {
    const entryStartBit = reader.bitOffset;
    const name = reader.readNullTerminatedString(maxString);
    if (!reader.readBoolean()) {
      boundaries?.push({
        tableIndex,
        tableName,
        section,
        entryIndex,
        entryName: name,
        entryStartBit,
        dataStartBit: null,
        dataLengthBytes: 0,
        entryEndBit: reader.bitOffset,
      });
      return { name, data: null };
    }
    const length = reader.readBits(16);
    if (length > maxData)
      throw new RangeError(
        `string table entry data ${length} exceeds ${maxData}`,
      );
    const dataStartBit = reader.bitOffset;
    const data = reader.readBytes(length);
    boundaries?.push({
      tableIndex,
      tableName,
      section,
      entryIndex,
      entryName: name,
      entryStartBit,
      dataStartBit,
      dataLengthBytes: length,
      entryEndBit: reader.bitOffset,
    });
    return { name, data };
  });
}

export interface UserInfoIdentity {
  readonly steamId64: bigint;
  readonly displayName: string;
  readonly userId: number;
  readonly fakePlayer: boolean;
  readonly sourceBytes: number;
}

/** Extracts the bounded identity fields used by L4DStats; GUID text is omitted. */
export function decodeL4d2UserInfo(data: Uint8Array): UserInfoIdentity {
  // Protocol-4 L4D2 player_info_t is at least 140 bytes including alignment.
  if (data.byteLength < 140)
    throw new BitReadError(
      "OUT_OF_BOUNDS",
      "truncated L4D2 userinfo",
      0,
      1120,
      data.byteLength * 8,
    );
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    // Protocol-2100 serializes XUID in network order even though adjacent
    // player_info_t scalar fields are little-endian.
    steamId64: view.getBigUint64(0, false),
    displayName: decodeNullTerminatedUtf8(data.subarray(8, 40)),
    userId: normalizeL4d2UserId(view.getInt32(40, true)),
    fakePlayer: data[116] !== 0,
    sourceBytes: data.byteLength,
  };
}

function decodeNullTerminatedUtf8(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder("utf-8", { fatal: false })
    .decode(end < 0 ? bytes : bytes.subarray(0, end))
    .trim();
}

/** Normalize the unambiguous high-byte user-ID shape seen in L4D2 SourceTV. */
function normalizeL4d2UserId(value: number): number {
  return value > 0xffff && (value & 0x00ffffff) === 0 ? value >>> 24 : value;
}

function limit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new RangeError(`${name} must be positive`);
  return result;
}

export interface NetworkStringTableSchema {
  readonly maxEntries: number;
  readonly userDataFixedSize: boolean;
  readonly userDataSizeBits: number | null;
  readonly existingNames?: ReadonlyMap<number, string>;
}

export interface NetworkStringTableChange {
  readonly entryIndex: number;
  readonly name?: string;
  readonly data?: Uint8Array;
}

/** Decodes a bounded Source network string-table entry stream. */
export function decodeNetworkStringTableChanges(
  bytes: Uint8Array,
  bitLength: number,
  entryCount: number,
  schema: NetworkStringTableSchema,
): readonly NetworkStringTableChange[] {
  if (bitLength < 1 || bitLength > bytes.byteLength * 8)
    throw new RangeError("invalid network string-table bit length");
  if (entryCount < 0 || entryCount > schema.maxEntries)
    throw new RangeError("invalid network string-table entry count");
  const reader = new BitReader(bytes);
  // L4D2's protocol-2100 stream prefixes dictionary-encoding capability.
  // The following entry grammar remains identical for either flag value.
  reader.readBoolean();
  const indexBits = Math.ceil(Math.log2(schema.maxEntries));
  const history: string[] = [];
  const result: NetworkStringTableChange[] = [];
  let lastEntry = -1;
  for (let count = 0; count < entryCount; count += 1) {
    const entryIndex = reader.readBoolean()
      ? lastEntry + 1
      : reader.readBits(indexBits);
    if (entryIndex < 0 || entryIndex >= schema.maxEntries)
      throw new RangeError(
        `invalid network string-table entry index ${entryIndex}/${schema.maxEntries} after ${lastEntry}`,
      );
    lastEntry = entryIndex;
    let name: string | undefined;
    if (reader.readBoolean()) {
      if (reader.readBoolean()) {
        const historyIndex = reader.readBits(5);
        const prefixLength = reader.readBits(5);
        const base = history[historyIndex];
        if (base === undefined || prefixLength > base.length)
          throw new RangeError(
            `invalid string-table substring reference ${historyIndex}/${history.length} prefix ${prefixLength}`,
          );
        name =
          base.slice(0, prefixLength) + reader.readNullTerminatedString(16_384);
      } else name = reader.readNullTerminatedString(16_384);
    }
    let data: Uint8Array | undefined;
    if (reader.readBoolean()) {
      const dataBits = schema.userDataFixedSize
        ? schema.userDataSizeBits
        : reader.readBits(14) * 8;
      if (dataBits === null || dataBits < 0 || dataBits > 8 * 1_048_576)
        throw new RangeError("invalid string-table user data length");
      data = reader.readBytes(Math.ceil(dataBits / 8));
    }
    const resolvedName = name ?? schema.existingNames?.get(entryIndex);
    if (resolvedName !== undefined) {
      history.push(resolvedName);
      if (history.length > 32) history.shift();
    }
    result.push({
      entryIndex,
      ...(name === undefined ? {} : { name }),
      ...(data === undefined ? {} : { data }),
    });
    if (reader.bitOffset > bitLength)
      throw new RangeError("string-table changes exceed declared bit length");
  }
  return result;
}

/** Unwraps L4D2's bounded Snappy create-table payload when flagged. */
export function unwrapL4d2StringTableData(
  bytes: Uint8Array,
  compressed: boolean,
  maxOutputBytes = 1_048_576,
): Uint8Array {
  if (!compressed) return bytes;
  if (bytes.byteLength < 8)
    throw new RangeError("truncated compressed string table");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expected = view.getUint32(0, true);
  const compressedBytes = view.getUint32(4, true);
  if (expected > maxOutputBytes || compressedBytes > bytes.byteLength - 8)
    throw new RangeError("compressed string table exceeds bounds");
  const payload = bytes.subarray(8, 8 + compressedBytes);
  if (
    payload[0] === 0x4c &&
    payload[1] === 0x5a &&
    payload[2] === 0x53 &&
    payload[3] === 0x53
  ) {
    const output = decodeValveLzss(payload, maxOutputBytes);
    if (output.byteLength !== expected)
      throw new RangeError("compressed string table size mismatch");
    return output;
  }
  // Valve's bounded SNAPPY wrapper stores output size separately.
  const prefix: number[] = [];
  for (let remaining = expected; ; remaining >>>= 7) {
    prefix.push((remaining & 0x7f) | (remaining > 0x7f ? 0x80 : 0));
    if (remaining <= 0x7f) break;
  }
  const framed = new Uint8Array(prefix.length + compressedBytes);
  framed.set(prefix);
  framed.set(payload, prefix.length);
  let output: Uint8Array;
  try {
    output = uncompress(framed, maxOutputBytes);
  } catch (error) {
    throw new RangeError(
      `invalid compressed string table ${expected}/${compressedBytes} ${[...bytes.subarray(8, 16)].map((v) => v.toString(16).padStart(2, "0")).join("")}: ${String(error)}`,
    );
  }
  if (output.byteLength !== expected)
    throw new RangeError("compressed string table size mismatch");
  return output;
}

function decodeValveLzss(input: Uint8Array, maximum: number): Uint8Array {
  if (input.byteLength < 8) throw new RangeError("truncated LZSS header");
  const size = new DataView(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  ).getUint32(4, true);
  if (size > maximum) throw new RangeError("LZSS output exceeds bounds");
  const output = new Uint8Array(size);
  let source = 8,
    target = 0,
    command = 0,
    bit = 0;
  while (target < size) {
    if (bit === 0) {
      if (source >= input.length)
        throw new RangeError("truncated LZSS command");
      command = input[source++]!;
    }
    bit = (bit + 1) & 7;
    if ((command & 1) === 0) {
      if (source >= input.length)
        throw new RangeError("truncated LZSS literal");
      output[target++] = input[source++]!;
    } else {
      if (source + 1 >= input.length)
        throw new RangeError("truncated LZSS back-reference");
      const position = (input[source++]! << 4) | (input[source]! >>> 4);
      const count = (input[source++]! & 0x0f) + 1;
      if (count === 1) break;
      if (position >= target || target + count > size)
        throw new RangeError("invalid LZSS back-reference");
      let copy = target - position - 1;
      for (let index = 0; index < count; index += 1)
        output[target++] = output[copy++]!;
    }
    command >>>= 1;
  }
  if (target !== size) throw new RangeError("LZSS output size mismatch");
  return output;
}
