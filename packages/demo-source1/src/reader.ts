export type BinaryReadErrorCode = "OUT_OF_BOUNDS" | "INVALID_LENGTH";

export class BinaryReadError extends Error {
  readonly code: BinaryReadErrorCode;
  readonly offset: number;
  readonly requestedBytes: number;
  readonly availableBytes: number;

  constructor(
    code: BinaryReadErrorCode,
    message: string,
    offset: number,
    requestedBytes: number,
    availableBytes: number,
  ) {
    super(message);
    this.name = "BinaryReadError";
    this.code = code;
    this.offset = offset;
    this.requestedBytes = requestedBytes;
    this.availableBytes = availableBytes;
  }
}

/** A cursor-based little-endian reader that never reads or seeks outside its input. */
export class BinaryReader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.#bytes.byteLength - this.#offset;
  }

  u8(): number {
    this.#require(1);
    return this.#bytes[this.#offset++]!;
  }

  i32(): number {
    this.#require(4);
    const value = this.#view.getInt32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  f32(): number {
    this.#require(4);
    const value = this.#view.getFloat32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.#validateLength(length);
    this.#require(length);
    const value = this.#bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  fixedString(length: number): string {
    const bytes = this.bytes(length);
    const terminator = bytes.indexOf(0);
    return new TextDecoder("latin1").decode(
      terminator === -1 ? bytes : bytes.subarray(0, terminator),
    );
  }

  #validateLength(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new BinaryReadError(
        "INVALID_LENGTH",
        `Invalid binary read length ${String(length)} at offset ${this.#offset}`,
        this.#offset,
        length,
        this.remaining,
      );
    }
  }

  #require(length: number): void {
    this.#validateLength(length);
    if (length > this.remaining) {
      throw new BinaryReadError(
        "OUT_OF_BOUNDS",
        `Need ${length} bytes at offset ${this.#offset}, only ${this.remaining} remain`,
        this.#offset,
        length,
        this.remaining,
      );
    }
  }
}
