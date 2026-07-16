export const DEMO_STAMP = "HL2DEMO";
export const DEMO_HEADER_BYTES = 1_072;

export interface DemoHeader {
  readonly stamp: typeof DEMO_STAMP;
  readonly demoProtocol: number;
  readonly networkProtocol: number;
  readonly serverName: string;
  readonly clientName: string;
  readonly mapName: string;
  readonly gameDirectory: string;
  readonly playbackTimeSeconds: number;
  readonly playbackTicks: number;
  readonly playbackFrames: number;
  readonly signonLength: number;
}

export type DemoCommandKind =
  | "signon"
  | "packet"
  | "sync-tick"
  | "console-command"
  | "user-command"
  | "data-tables"
  | "stop"
  | "custom-data"
  | "string-tables";

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CommandInfo {
  readonly flags: number;
  readonly viewOrigin: Vector3;
  readonly viewAngles: Vector3;
  readonly localViewAngles: Vector3;
  readonly viewOrigin2: Vector3;
  readonly viewAngles2: Vector3;
  readonly localViewAngles2: Vector3;
}

export interface DemoCommandFrame {
  readonly command: number;
  readonly kind: DemoCommandKind;
  /** Null only when an old-engine stop marker omits its optional tick. */
  readonly tick: number | null;
  /** Present in demo protocol 4 and later. It is a demo-local slot, not an identity. */
  readonly playerSlot: number | null;
  readonly offset: number;
  readonly commandInfo?: readonly CommandInfo[];
  readonly sequenceIn?: number;
  readonly sequenceOut?: number;
  readonly outgoingSequence?: number;
  readonly customDataCallback?: number;
  /** Opaque until the corresponding payload decoder is implemented. A zero-copy input view. */
  readonly payload?: Uint8Array;
}

export interface DecodeIssue {
  readonly code: "UNKNOWN_DEMO_COMMAND" | "TRAILING_DATA";
  readonly offset: number;
  readonly command?: number;
  readonly message: string;
}

export interface DemoDecodeResult {
  readonly header: DemoHeader;
  readonly frames: readonly DemoCommandFrame[];
  readonly issues: readonly DecodeIssue[];
  readonly stopped: boolean;
  readonly bytesConsumed: number;
}

export type DemoParseErrorCode =
  | "INPUT_TOO_LARGE"
  | "INVALID_STAMP"
  | "UNSUPPORTED_DEMO_PROTOCOL"
  | "INVALID_HEADER"
  | "COMMAND_LIMIT"
  | "INVALID_PAYLOAD_LENGTH"
  | "PAYLOAD_TOO_LARGE"
  | "TRUNCATED";

export class DemoParseError extends Error {
  readonly code: DemoParseErrorCode;
  readonly offset: number;
  override readonly cause?: unknown;

  constructor(
    code: DemoParseErrorCode,
    message: string,
    offset: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = "DemoParseError";
    this.code = code;
    this.offset = offset;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface DecodeOptions {
  readonly maxInputBytes?: number;
  readonly maxCommands?: number;
  readonly maxPayloadBytes?: number;
}
