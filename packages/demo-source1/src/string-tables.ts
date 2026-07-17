import { BitReadError, BitReader } from "./bit-reader";

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
    );
    const clientEntries = reader.readBoolean()
      ? readEntries(reader, reader.readBits(16), maxEntries, maxString, maxData)
      : [];
    tables.push({ name, entries, clientEntries });
  }
  return { tables, consumedBits: reader.bitOffset };
}

function readEntries(
  reader: BitReader,
  count: number,
  maxEntries: number,
  maxString: number,
  maxData: number,
): DemoStringTableEntry[] {
  if (count > maxEntries)
    throw new RangeError(
      `string table entry count ${count} exceeds ${maxEntries}`,
    );
  return Array.from({ length: count }, () => {
    const name = reader.readNullTerminatedString(maxString);
    if (!reader.readBoolean()) return { name, data: null };
    const length = reader.readBits(16);
    if (length > maxData)
      throw new RangeError(
        `string table entry data ${length} exceeds ${maxData}`,
      );
    return { name, data: reader.readBytes(length) };
  });
}

export interface UserInfoIdentity {
  readonly steamId64: bigint;
  readonly userId: number;
  readonly fakePlayer: boolean;
  readonly sourceBytes: number;
}

/** Extracts identity fields only; names and GUID strings are deliberately omitted. */
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
    steamId64: view.getBigUint64(0, true),
    userId: view.getInt32(40, true),
    fakePlayer: data[116] !== 0,
    sourceBytes: data.byteLength,
  };
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
