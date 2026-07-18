import { BinaryReader, BinaryReadError } from "./reader.js";
import {
  DEMO_HEADER_BYTES,
  DEMO_STAMP,
  DemoParseError,
  type CommandInfo,
  type DecodeOptions,
  type DemoCommandFrame,
  type DemoCommandKind,
  type DemoDecodeResult,
  type DemoHeader,
  type Vector3,
} from "./types.js";

const DEFAULT_MAX_INPUT_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_COMMANDS = 10_000_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const FIXED_STRING_BYTES = 260;

const COMMAND_KINDS: Readonly<Record<number, DemoCommandKind>> = {
  1: "signon",
  2: "packet",
  3: "sync-tick",
  4: "console-command",
  5: "user-command",
  6: "data-tables",
  7: "stop",
  8: "custom-data",
  9: "string-tables",
};

export function decodeDemo(
  bytes: Uint8Array,
  options: DecodeOptions = {},
): DemoDecodeResult {
  const maxInputBytes = positiveLimit(
    options.maxInputBytes,
    DEFAULT_MAX_INPUT_BYTES,
    "maxInputBytes",
  );
  const maxCommands = positiveLimit(
    options.maxCommands,
    DEFAULT_MAX_COMMANDS,
    "maxCommands",
  );
  const maxPayloadBytes = positiveLimit(
    options.maxPayloadBytes,
    DEFAULT_MAX_PAYLOAD_BYTES,
    "maxPayloadBytes",
  );
  if (bytes.byteLength > maxInputBytes) {
    throw new DemoParseError(
      "INPUT_TOO_LARGE",
      `Demo is ${bytes.byteLength} bytes; limit is ${maxInputBytes}`,
      0,
    );
  }

  const reader = new BinaryReader(bytes);
  try {
    const header = readHeader(reader);
    const frames: DemoCommandFrame[] = [];
    const issues: DemoDecodeResult["issues"][number][] = [];
    let stopped = false;

    while (reader.remaining > 0) {
      if (frames.length >= maxCommands) {
        throw new DemoParseError(
          "COMMAND_LIMIT",
          `Demo exceeds command limit ${maxCommands}`,
          reader.offset,
        );
      }
      const offset = reader.offset;
      const command = reader.u8();
      const kind = COMMAND_KINDS[command];
      if (kind === undefined) {
        issues.push({
          code: "UNKNOWN_DEMO_COMMAND",
          offset,
          command,
          message: `Unknown demo command ${command}; remaining bytes cannot be framed safely`,
        });
        break;
      }
      // Stop is branch-dependent. L4D2 writes the command and tick but no slot;
      // some old-engine demos contain only the command byte.
      if (kind === "stop") {
        const tick = reader.remaining >= 4 ? reader.i32() : null;
        frames.push({ command, kind, tick, playerSlot: null, offset });
        stopped = true;
        if (reader.remaining > 0) {
          issues.push({
            code: "TRAILING_DATA",
            offset: reader.offset,
            message: `${reader.remaining} bytes follow the stop command`,
          });
        }
        break;
      }
      const tick = reader.i32();
      const playerSlot = header.demoProtocol >= 4 ? reader.u8() : null;
      const common = { command, kind, tick, playerSlot, offset } as const;
      if (kind === "sync-tick") {
        frames.push(common);
        continue;
      }
      if (kind === "signon" || kind === "packet") {
        // The Orange Box/L4D demo-protocol-4 branch reserves four split-screen
        // command-info records. This differs from branches that reserve two.
        const commandInfoCount = header.demoProtocol >= 4 ? 4 : 1;
        const commandInfo = Array.from({ length: commandInfoCount }, () =>
          readCommandInfo(reader),
        );
        const sequenceIn = reader.i32();
        const sequenceOut = reader.i32();
        const payload = readPayload(reader, maxPayloadBytes);
        frames.push({
          ...common,
          commandInfo,
          sequenceIn,
          sequenceOut,
          payload,
        });
        continue;
      }
      if (kind === "user-command") {
        const outgoingSequence = reader.i32();
        frames.push({
          ...common,
          outgoingSequence,
          payload: readPayload(reader, maxPayloadBytes),
        });
        continue;
      }
      if (kind === "custom-data") {
        const customDataCallback = reader.i32();
        frames.push({
          ...common,
          customDataCallback,
          payload: readPayload(reader, maxPayloadBytes),
        });
        continue;
      }
      frames.push({ ...common, payload: readPayload(reader, maxPayloadBytes) });
    }

    return { header, frames, issues, stopped, bytesConsumed: reader.offset };
  } catch (error) {
    if (error instanceof DemoParseError) throw error;
    if (error instanceof BinaryReadError) {
      throw new DemoParseError(
        "TRUNCATED",
        `Truncated demo at byte ${error.offset}: ${error.message}`,
        error.offset,
        error,
      );
    }
    throw error;
  }
}

function readHeader(reader: BinaryReader): DemoHeader {
  if (reader.remaining < DEMO_HEADER_BYTES) {
    throw new DemoParseError(
      "TRUNCATED",
      `Demo header needs ${DEMO_HEADER_BYTES} bytes; only ${reader.remaining} available`,
      reader.offset,
    );
  }
  const stamp = reader.fixedString(8);
  if (stamp !== DEMO_STAMP) {
    throw new DemoParseError(
      "INVALID_STAMP",
      `Expected ${DEMO_STAMP} demo stamp, received ${JSON.stringify(stamp)}`,
      0,
    );
  }
  const demoProtocol = reader.i32();
  if (demoProtocol !== 3 && demoProtocol !== 4) {
    throw new DemoParseError(
      "UNSUPPORTED_DEMO_PROTOCOL",
      `Demo protocol ${demoProtocol} is not supported (expected 3 or 4)`,
      8,
    );
  }
  const networkProtocol = reader.i32();
  const serverName = reader.fixedString(FIXED_STRING_BYTES);
  const clientName = reader.fixedString(FIXED_STRING_BYTES);
  const mapName = reader.fixedString(FIXED_STRING_BYTES);
  const gameDirectory = reader.fixedString(FIXED_STRING_BYTES);
  const playbackTimeSeconds = reader.f32();
  const playbackTicks = reader.i32();
  const playbackFrames = reader.i32();
  const signonLength = reader.i32();
  if (
    !Number.isFinite(playbackTimeSeconds) ||
    playbackTimeSeconds < 0 ||
    playbackTicks < 0 ||
    playbackFrames < 0 ||
    signonLength < 0
  ) {
    throw new DemoParseError(
      "INVALID_HEADER",
      "Demo header contains negative or non-finite playback metadata",
      DEMO_HEADER_BYTES - 16,
    );
  }
  return {
    stamp: DEMO_STAMP,
    demoProtocol,
    networkProtocol,
    serverName,
    clientName,
    mapName,
    gameDirectory,
    playbackTimeSeconds,
    playbackTicks,
    playbackFrames,
    signonLength,
  };
}

function readCommandInfo(reader: BinaryReader): CommandInfo {
  return {
    flags: reader.i32(),
    viewOrigin: readVector(reader),
    viewAngles: readVector(reader),
    localViewAngles: readVector(reader),
    viewOrigin2: readVector(reader),
    viewAngles2: readVector(reader),
    localViewAngles2: readVector(reader),
  };
}

function readVector(reader: BinaryReader): Vector3 {
  return { x: reader.f32(), y: reader.f32(), z: reader.f32() };
}

function readPayload(
  reader: BinaryReader,
  maxPayloadBytes: number,
): Uint8Array {
  const lengthOffset = reader.offset;
  const length = reader.i32();
  if (length < 0) {
    throw new DemoParseError(
      "INVALID_PAYLOAD_LENGTH",
      `Negative payload length ${length}`,
      lengthOffset,
    );
  }
  if (length > maxPayloadBytes) {
    throw new DemoParseError(
      "PAYLOAD_TOO_LARGE",
      `Payload is ${length} bytes; limit is ${maxPayloadBytes}`,
      lengthOffset,
    );
  }
  return reader.bytes(length);
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return limit;
}
