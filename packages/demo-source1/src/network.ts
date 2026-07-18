import { BitReadError, BitReader } from "./bit-reader.js";

export const SOURCE1_MESSAGE_TYPE_BITS = 6;

const MESSAGE_NAMES: Readonly<Record<number, string>> = {
  0: "net_NOP",
  1: "net_Disconnect",
  2: "net_File",
  3: "net_SplitScreenUser",
  4: "net_Tick",
  5: "net_StringCmd",
  6: "net_SetConVar",
  7: "net_SignonState",
  8: "svc_ServerInfo",
  9: "svc_SendTable",
  10: "svc_ClassInfo",
  11: "svc_SetPause",
  12: "svc_CreateStringTable",
  13: "svc_UpdateStringTable",
  14: "svc_VoiceInit",
  15: "svc_VoiceData",
  16: "svc_Print",
  17: "svc_Sounds",
  18: "svc_SetView",
  19: "svc_FixAngle",
  20: "svc_CrosshairAngle",
  21: "svc_BSPDecal",
  22: "svc_SplitScreen",
  23: "svc_UserMessage",
  24: "svc_EntityMessage",
  25: "svc_GameEvent",
  26: "svc_PacketEntities",
  27: "svc_TempEntities",
  28: "svc_Prefetch",
  29: "svc_Menu",
  30: "svc_GameEventList",
  31: "svc_GetCvarValue",
  32: "svc_CmdKeyValues",
  33: "svc_PaintmapData",
};

export interface NetworkMessageBoundary {
  readonly id: number;
  readonly name: string;
  readonly startBit: number;
  readonly endBit: number | null;
  readonly status:
    | "decoded-boundary"
    | "unsupported"
    | "truncated"
    | "malformed";
  readonly envelope?: NetworkMessageEnvelope;
  readonly reason?: string;
}

export interface NetworkPayloadInspection {
  readonly bitLength: number;
  readonly consumedBits: number;
  readonly trailingPaddingBits: number;
  readonly messages: readonly NetworkMessageBoundary[];
  readonly complete: boolean;
}

export interface NetworkInspectionLimits {
  readonly maxMessages?: number;
  readonly maxStringBytes?: number;
  readonly maxStringTableEntries?: number;
  readonly maxMessageDataBits?: number;
}

export interface CreateStringTableEnvelope {
  readonly tableName: string;
  readonly maxEntries: number;
  readonly entryCount: number;
  readonly dataBitLength: number;
  readonly userDataFixedSize: boolean;
  readonly userDataSize: number | null;
  readonly userDataSizeBits: number | null;
  readonly isFilenames: boolean;
  readonly flags: number;
  readonly dataCompressed: boolean;
  readonly dataStartBit: number;
}

export interface UpdateStringTableEnvelope {
  readonly tableId: number;
  readonly changedEntries: number;
  readonly dataBitLength: number;
  readonly dataStartBit: number;
}

export interface PacketEntitiesEnvelope {
  readonly maxEntries: number;
  readonly isDelta: boolean;
  readonly deltaFrom: number | null;
  readonly baseline: 0 | 1;
  readonly updatedEntries: number;
  readonly dataBitLength: number;
  readonly updateBaseline: boolean;
  /** Absolute bit offset of the nested entity stream in the inspected payload. */
  readonly dataStartBit: number;
}

export interface GameEventDataEnvelope {
  readonly dataBitLength: number;
  /** Absolute bit offset of the nested event stream in the inspected payload. */
  readonly dataStartBit: number;
}

export interface GameEventListEnvelope extends GameEventDataEnvelope {
  readonly eventCount: number;
}

export type NetworkMessageEnvelope =
  | {
      readonly kind: "tick";
      readonly value: { readonly engineTick: number };
    }
  | {
      readonly kind: "create-string-table";
      readonly value: CreateStringTableEnvelope;
    }
  | {
      readonly kind: "update-string-table";
      readonly value: UpdateStringTableEnvelope;
    }
  | {
      readonly kind: "packet-entities";
      readonly value: PacketEntitiesEnvelope;
    }
  | {
      readonly kind: "game-event";
      readonly value: GameEventDataEnvelope;
    }
  | {
      readonly kind: "game-event-list";
      readonly value: GameEventListEnvelope;
    };

export interface NetworkMessageIdentifier {
  readonly id: number;
  readonly name: string;
}

export interface L4d2ServerInfo {
  readonly networkProtocol: number;
  readonly serverCount: number;
  readonly isSourceTv: boolean;
  readonly dedicated: boolean;
  readonly maxServerClasses: number;
  readonly playerCount: number;
  readonly maxClients: number;
  readonly tickIntervalSeconds: number;
  readonly platformCode: number;
}

/** Decodes protocol-2100 ServerInfo while deliberately omitting identifying strings. */
export function decodeL4d2ServerInfo(
  bytes: Uint8Array,
  maxStringBytes = 16_384,
): L4d2ServerInfo {
  const reader = new BitReader(bytes);
  if (reader.readBits(6) !== 8)
    throw new RangeError("payload does not start with svc_ServerInfo");
  const networkProtocol = reader.readBits(16);
  const serverCount = reader.readBits(32);
  const isSourceTv = reader.readBoolean();
  const dedicated = reader.readBoolean();
  reader.skipBits(32); // client CRC
  reader.skipBits(32); // string-table CRC (demo protocol 4)
  reader.skipBits(1); // restrict-workshop-addons flag in current L4D2 builds
  const maxServerClasses = reader.readBits(16);
  reader.skipBits(32); // map CRC for L4D2 protocol 2100
  const playerCount = reader.readBits(8);
  const maxClients = reader.readBits(8);
  const tickIntervalSeconds = reader.readFloat32();
  const platformCode = reader.readBits(8);
  // Game dir, map, sky, and hostname are framing inputs but intentionally redacted.
  for (let index = 0; index < 4; index += 1)
    reader.readNullTerminatedString(maxStringBytes);
  return {
    networkProtocol,
    serverCount,
    isSourceTv,
    dedicated,
    maxServerClasses,
    playerCount,
    maxClients,
    tickIntervalSeconds,
    platformCode,
  };
}

/** Reads the only universally framed portion of a non-empty message: its ID. */
export function identifyFirstNetworkMessage(
  bytes: Uint8Array,
): NetworkMessageIdentifier | null {
  const reader = new BitReader(bytes);
  if (reader.remainingBits < SOURCE1_MESSAGE_TYPE_BITS) return null;
  const id = reader.readBits(SOURCE1_MESSAGE_TYPE_BITS);
  return { id, name: MESSAGE_NAMES[id] ?? `unknown_${id}` };
}

/**
 * Walks only network message boundaries proven for the Orange Box/L4D wire
 * format. An unsupported message ends inspection at its six-bit identifier;
 * unlike a heuristic scanner this can never manufacture later boundaries.
 */
export function inspectNetworkPayload(
  bytes: Uint8Array,
  limits: NetworkInspectionLimits = {},
): NetworkPayloadInspection {
  const maxMessages = positiveLimit(limits.maxMessages, 65_536, "maxMessages");
  const maxStringBytes = positiveLimit(
    limits.maxStringBytes,
    16_384,
    "maxStringBytes",
  );
  const maxStringTableEntries = positiveLimit(
    limits.maxStringTableEntries,
    65_535,
    "maxStringTableEntries",
  );
  const maxMessageDataBits = positiveLimit(
    limits.maxMessageDataBits,
    8 * 1_048_576,
    "maxMessageDataBits",
  );
  const reader = new BitReader(bytes);
  const messages: NetworkMessageBoundary[] = [];

  while (reader.remainingBits >= SOURCE1_MESSAGE_TYPE_BITS) {
    if (messages.length >= maxMessages)
      throw new RangeError("network message limit exceeded");
    if (
      reader.remainingBits <= 7 &&
      remainingBitsAreZero(bytes, reader.bitOffset)
    )
      break;

    const startBit = reader.bitOffset;
    const id = reader.readBits(SOURCE1_MESSAGE_TYPE_BITS);
    const name = MESSAGE_NAMES[id] ?? `unknown_${id}`;
    try {
      const envelope = skipKnownMessage(
        reader,
        id,
        maxStringBytes,
        maxStringTableEntries,
        maxMessageDataBits,
      );
      if (!envelope) {
        messages.push({
          id,
          name,
          startBit,
          endBit: null,
          status: "unsupported",
        });
        return finish(bytes, reader, messages, false);
      }
      messages.push({
        id,
        name,
        startBit,
        endBit: reader.bitOffset,
        status: "decoded-boundary",
        ...(envelope === true ? {} : { envelope }),
      });
    } catch (error) {
      if (!(error instanceof BitReadError || error instanceof RangeError))
        throw error;
      messages.push({
        id,
        name,
        startBit,
        endBit: null,
        status: error instanceof BitReadError ? "truncated" : "malformed",
        reason: error.message,
      });
      return finish(bytes, reader, messages, false);
    }
  }
  return finish(bytes, reader, messages, true);
}

function skipKnownMessage(
  reader: BitReader,
  id: number,
  maxStringBytes: number,
  maxStringTableEntries: number,
  maxMessageDataBits: number,
): true | NetworkMessageEnvelope | false {
  switch (id) {
    case 0:
      return true;
    case 2:
      reader.skipBits(32);
      reader.readNullTerminatedString(maxStringBytes);
      reader.skipBits(2);
      return true;
    case 1:
    case 5:
    case 16:
      reader.readNullTerminatedString(maxStringBytes);
      return true;
    case 3:
      reader.skipBits(1);
      return true;
    case 4:
      const engineTick = reader.readBits(32);
      reader.skipBits(16 + 16);
      return { kind: "tick", value: { engineTick } };
    case 6: {
      const count = reader.readBits(8);
      for (let index = 0; index < count; index += 1) {
        reader.readNullTerminatedString(maxStringBytes);
        reader.readNullTerminatedString(maxStringBytes);
      }
      return true;
    }
    case 7: {
      reader.skipBits(8 + 32 + 32);
      const playerIdsBytes = reader.readBits(32);
      requireAtMost(playerIdsBytes * 8, maxMessageDataBits, "player ID bits");
      reader.skipBits(playerIdsBytes * 8);
      const mapNameBytes = reader.readBits(32);
      requireAtMost(mapNameBytes * 8, maxMessageDataBits, "map name bits");
      reader.skipBits(mapNameBytes * 8);
      return true;
    }
    case 8:
      skipServerInfo(reader, maxStringBytes);
      return true;
    case 9: {
      reader.skipBits(1);
      const bitLength = reader.readBits(16);
      reader.skipBits(bitLength);
      return true;
    }
    case 10: {
      const classCount = reader.readBits(16);
      const createOnClient = reader.readBoolean();
      if (!createOnClient) {
        const classIdBits = Math.ceil(Math.log2(classCount));
        for (let index = 0; index < classCount; index += 1) {
          reader.skipBits(classIdBits);
          reader.readNullTerminatedString(maxStringBytes);
          reader.readNullTerminatedString(maxStringBytes);
        }
      }
      return true;
    }
    case 11:
      reader.skipBits(1);
      return true;
    case 12:
      return {
        kind: "create-string-table",
        value: readCreateStringTableEnvelope(
          reader,
          maxStringBytes,
          maxStringTableEntries,
          maxMessageDataBits,
        ),
      };
    case 13:
      return {
        kind: "update-string-table",
        value: readUpdateStringTableEnvelope(reader, maxMessageDataBits),
      };
    case 14: {
      const codec = reader.readNullTerminatedString(maxStringBytes);
      const quality = reader.readBits(8);
      if (quality === 255) reader.skipBits(16);
      void codec;
      return true;
    }
    case 15: {
      reader.skipBits(8 + 8);
      const bitLength = reader.readBits(16);
      reader.skipBits(4 + bitLength);
      return true;
    }
    case 17: {
      const reliable = reader.readBoolean();
      if (!reliable) reader.skipBits(8);
      const bitLength = reader.readBits(reliable ? 8 : 16);
      reader.skipBits(bitLength);
      return true;
    }
    case 18:
      reader.skipBits(11);
      return true;
    case 19:
      reader.skipBits(1 + 16 * 3);
      return true;
    case 20:
      reader.skipBits(16 * 3);
      return true;
    case 21: {
      const axes = [
        reader.readBoolean(),
        reader.readBoolean(),
        reader.readBoolean(),
      ];
      for (const present of axes) if (present) skipBitCoord(reader);
      reader.skipBits(9);
      if (reader.readBoolean()) reader.skipBits(11 + 12);
      reader.skipBits(1);
      return true;
    }
    case 22:
      reader.skipBits(1 + 1 + 11);
      return true;
    case 23: {
      reader.skipBits(8);
      const bitLength = reader.readBits(11);
      reader.skipBits(bitLength);
      return true;
    }
    case 24:
      reader.skipBits(11 + 9);
      reader.skipBits(reader.readBits(11));
      return true;
    case 25: {
      const bitLength = reader.readBits(11);
      requireAtMost(bitLength, maxMessageDataBits, "game event data bits");
      const dataStartBit = reader.bitOffset;
      reader.skipBits(bitLength);
      return {
        kind: "game-event",
        value: { dataBitLength: bitLength, dataStartBit },
      };
    }
    case 26: {
      const maxEntries = reader.readBits(11);
      const isDelta = reader.readBoolean();
      const deltaFrom = isDelta ? reader.readBits(32) : null;
      const baseline = reader.readBits(1) as 0 | 1;
      const updatedEntries = reader.readBits(11);
      const bitLength = reader.readBits(20);
      requireAtMost(bitLength, maxMessageDataBits, "packet entity data bits");
      const updateBaseline = reader.readBoolean();
      const dataStartBit = reader.bitOffset;
      reader.skipBits(bitLength);
      return {
        kind: "packet-entities",
        value: {
          maxEntries,
          isDelta,
          deltaFrom,
          baseline,
          updatedEntries,
          dataBitLength: bitLength,
          updateBaseline,
          dataStartBit,
        },
      };
    }
    case 27:
      reader.skipBits(8);
      reader.skipBits(reader.readBits(18));
      return true;
    case 28:
      reader.skipBits(15);
      return true;
    case 29:
      reader.skipBits(16);
      reader.skipBits(reader.readBits(32));
      return true;
    case 30: {
      const eventCount = reader.readBits(9);
      const bitLength = reader.readBits(20);
      requireAtMost(bitLength, maxMessageDataBits, "game event list data bits");
      const dataStartBit = reader.bitOffset;
      reader.skipBits(bitLength);
      return {
        kind: "game-event-list",
        value: { eventCount, dataBitLength: bitLength, dataStartBit },
      };
    }
    case 31:
      reader.skipBits(32);
      reader.readNullTerminatedString(maxStringBytes);
      return true;
    case 32: {
      const byteLength = reader.readBits(32);
      requireAtMost(byteLength * 8, maxMessageDataBits, "key-values bits");
      reader.skipBits(byteLength * 8);
      return true;
    }
    case 33: {
      const bitLength = reader.readBits(32);
      requireAtMost(bitLength, maxMessageDataBits, "paintmap bits");
      reader.skipBits(bitLength);
      return true;
    }
    default:
      return false;
  }
}

/** Copies an arbitrary LSB-first bit range into a byte-aligned bounded buffer. */
export function extractNetworkBits(
  bytes: Uint8Array,
  startBit: number,
  bitLength: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(startBit) ||
    !Number.isSafeInteger(bitLength) ||
    startBit < 0 ||
    bitLength < 0 ||
    startBit + bitLength > bytes.byteLength * 8
  )
    throw new RangeError("network bit range is outside payload");
  const result = new Uint8Array(Math.ceil(bitLength / 8));
  for (let bit = 0; bit < bitLength; bit += 1) {
    const source = startBit + bit;
    result[bit >>> 3] =
      result[bit >>> 3]! |
      (((bytes[source >>> 3]! >>> (source & 7)) & 1) << (bit & 7));
  }
  return result;
}

/** Decodes only the framing envelope and skips the encoded table entries. */
export function decodeCreateStringTableEnvelope(
  bytes: Uint8Array,
  limits: NetworkInspectionLimits = {},
): CreateStringTableEnvelope {
  const reader = new BitReader(bytes);
  if (reader.readBits(SOURCE1_MESSAGE_TYPE_BITS) !== 12)
    throw new RangeError("payload does not start with svc_CreateStringTable");
  return readCreateStringTableEnvelope(
    reader,
    positiveLimit(limits.maxStringBytes, 16_384, "maxStringBytes"),
    positiveLimit(
      limits.maxStringTableEntries,
      65_535,
      "maxStringTableEntries",
    ),
    positiveLimit(
      limits.maxMessageDataBits,
      8 * 1_048_576,
      "maxMessageDataBits",
    ),
  );
}

/** Decodes only the framing envelope and skips the encoded table entries. */
export function decodeUpdateStringTableEnvelope(
  bytes: Uint8Array,
  limits: NetworkInspectionLimits = {},
): UpdateStringTableEnvelope {
  const reader = new BitReader(bytes);
  if (reader.readBits(SOURCE1_MESSAGE_TYPE_BITS) !== 13)
    throw new RangeError("payload does not start with svc_UpdateStringTable");
  return readUpdateStringTableEnvelope(
    reader,
    positiveLimit(
      limits.maxMessageDataBits,
      8 * 1_048_576,
      "maxMessageDataBits",
    ),
  );
}

function readCreateStringTableEnvelope(
  reader: BitReader,
  maxStringBytes: number,
  maxEntriesLimit: number,
  maxMessageDataBits: number,
): CreateStringTableEnvelope {
  const tableName = reader.readNullTerminatedString(maxStringBytes);
  const maxEntries = reader.readBits(16);
  if (maxEntries === 0 || maxEntries > maxEntriesLimit)
    throw new RangeError(`string table max entries ${maxEntries} is invalid`);
  const entryCountBits = Math.floor(Math.log2(maxEntries)) + 1;
  const entryCount = reader.readBits(entryCountBits);
  if (entryCount > maxEntries)
    throw new RangeError(
      `string table entry count ${entryCount} exceeds ${maxEntries}`,
    );
  const dataBitLength = reader.readBits(21);
  requireAtMost(dataBitLength, maxMessageDataBits, "string table data bits");
  const userDataFixedSize = reader.readBoolean();
  const userDataSize = userDataFixedSize ? reader.readBits(12) : null;
  const userDataSizeBits = userDataFixedSize ? reader.readBits(4) : null;
  const flags = reader.readBits(2);
  const dataCompressed = (flags & 1) !== 0;
  const isFilenames = (flags & 2) !== 0;
  const dataStartBit = reader.bitOffset;
  reader.skipBits(dataBitLength);
  return {
    tableName,
    maxEntries,
    entryCount,
    dataBitLength,
    userDataFixedSize,
    userDataSize,
    userDataSizeBits,
    isFilenames,
    flags,
    dataCompressed,
    dataStartBit,
  };
}

function readUpdateStringTableEnvelope(
  reader: BitReader,
  maxMessageDataBits: number,
): UpdateStringTableEnvelope {
  const tableId = reader.readBits(5);
  const changedEntries = reader.readBoolean() ? reader.readBits(16) : 1;
  const dataBitLength = reader.readBits(20);
  requireAtMost(dataBitLength, maxMessageDataBits, "string table update bits");
  const dataStartBit = reader.bitOffset;
  reader.skipBits(dataBitLength);
  return { tableId, changedEntries, dataBitLength, dataStartBit };
}

function requireAtMost(value: number, limit: number, label: string): void {
  if (value > limit) throw new RangeError(`${label} ${value} exceeds ${limit}`);
}

function skipServerInfo(reader: BitReader, maxStringBytes: number): void {
  reader.skipBits(16 + 32 + 1 + 1); // protocol, count, SourceTV, dedicated
  reader.skipBits(32 + 32); // client and string-table CRCs
  reader.skipBits(1); // restrict-workshop-addons flag in current L4D2 builds
  reader.skipBits(16 + 32 + 8 + 8 + 32 + 8);
  // Current L4D2 protocol-2100 builds append mission and mutation names.
  for (let index = 0; index < 6; index += 1)
    reader.readNullTerminatedString(maxStringBytes);
}

function skipBitCoord(reader: BitReader): void {
  const hasInteger = reader.readBoolean();
  const hasFraction = reader.readBoolean();
  if (!hasInteger && !hasFraction) return;
  reader.skipBits(1);
  if (hasInteger) reader.skipBits(14);
  if (hasFraction) reader.skipBits(5);
}

function finish(
  bytes: Uint8Array,
  reader: BitReader,
  messages: readonly NetworkMessageBoundary[],
  complete: boolean,
): NetworkPayloadInspection {
  const padding = complete ? reader.remainingBits : 0;
  return {
    bitLength: bytes.byteLength * 8,
    consumedBits: reader.bitOffset,
    trailingPaddingBits: padding,
    messages,
    complete,
  };
}

function remainingBitsAreZero(bytes: Uint8Array, startBit: number): boolean {
  for (let bit = startBit; bit < bytes.byteLength * 8; bit += 1) {
    if (((bytes[bit >>> 3]! >>> (bit & 7)) & 1) !== 0) return false;
  }
  return true;
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new RangeError(`${name} must be positive`);
  return result;
}
