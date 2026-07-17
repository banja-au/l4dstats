import { BitReadError, BitReader } from "./bit-reader";

export const SOURCE1_MESSAGE_TYPE_BITS = 6;

const MESSAGE_NAMES: Readonly<Record<number, string>> = {
  0: "net_NOP",
  1: "net_Disconnect",
  2: "net_File",
  3: "net_Tick",
  4: "net_StringCmd",
  5: "net_SetConVar",
  6: "net_SignonState",
  7: "svc_Print",
  8: "svc_ServerInfo",
  9: "svc_SendTable",
  10: "svc_ClassInfo",
  11: "svc_SetPause",
  12: "svc_CreateStringTable",
  13: "svc_UpdateStringTable",
  14: "svc_VoiceInit",
  15: "svc_VoiceData",
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
};

export interface NetworkMessageBoundary {
  readonly id: number;
  readonly name: string;
  readonly startBit: number;
  readonly endBit: number | null;
  readonly status: "decoded-boundary" | "unsupported" | "truncated";
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
}

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
      if (!skipKnownMessage(reader, id, maxStringBytes)) {
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
      });
    } catch (error) {
      if (!(error instanceof BitReadError)) throw error;
      messages.push({ id, name, startBit, endBit: null, status: "truncated" });
      return finish(bytes, reader, messages, false);
    }
  }
  return finish(bytes, reader, messages, true);
}

function skipKnownMessage(
  reader: BitReader,
  id: number,
  maxStringBytes: number,
): boolean {
  switch (id) {
    case 0:
      return true;
    case 1:
    case 4:
    case 7:
      reader.readNullTerminatedString(maxStringBytes);
      return true;
    case 3:
      reader.skipBits(32 + 16 + 16);
      return true;
    case 5: {
      const count = reader.readBits(8);
      for (let index = 0; index < count; index += 1) {
        reader.readNullTerminatedString(maxStringBytes);
        reader.readNullTerminatedString(maxStringBytes);
      }
      return true;
    }
    case 11:
      reader.skipBits(1);
      return true;
    case 18:
      reader.skipBits(11);
      return true;
    case 19:
      reader.skipBits(1 + 16 * 3);
      return true;
    case 20:
      reader.skipBits(16 * 3);
      return true;
    case 23: {
      reader.skipBits(8);
      const bitLength = reader.readBits(11);
      reader.skipBits(bitLength);
      return true;
    }
    case 25: {
      const bitLength = reader.readBits(11);
      reader.skipBits(bitLength);
      return true;
    }
    case 26: {
      reader.skipBits(11);
      const isDelta = reader.readBoolean();
      if (isDelta) reader.skipBits(32);
      reader.skipBits(1 + 11);
      const bitLength = reader.readBits(20);
      reader.skipBits(1 + bitLength);
      return true;
    }
    case 28:
      reader.skipBits(13);
      return true;
    case 31:
      reader.skipBits(32);
      reader.readNullTerminatedString(maxStringBytes);
      return true;
    default:
      return false;
  }
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
