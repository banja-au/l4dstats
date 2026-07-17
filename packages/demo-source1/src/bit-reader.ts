export type BitReadErrorCode = "OUT_OF_BOUNDS" | "INVALID_LENGTH";

export class BitReadError extends Error {
  constructor(
    readonly code: BitReadErrorCode,
    message: string,
    readonly bitOffset: number,
    readonly requestedBits: number,
    readonly availableBits: number,
  ) {
    super(message);
    this.name = "BitReadError";
  }
}

/** LSB-first bit reader used by Source 1 network payloads. */
export class BitReader {
  #bitOffset = 0;

  constructor(readonly bytes: Uint8Array) {}

  get bitOffset(): number {
    return this.#bitOffset;
  }

  get remainingBits(): number {
    return this.bytes.byteLength * 8 - this.#bitOffset;
  }

  readBits(length: number): number {
    this.#require(length);
    let value = 0;
    for (let bit = 0; bit < length; bit += 1) {
      const absolute = this.#bitOffset + bit;
      value +=
        ((this.bytes[absolute >>> 3]! >>> (absolute & 7)) & 1) * 2 ** bit;
    }
    this.#bitOffset += length;
    return value;
  }

  readBoolean(): boolean {
    return this.readBits(1) === 1;
  }

  readSignedBits(length: number): number {
    if (length === 0) return 0;
    const value = this.readBits(length);
    const sign = 2 ** (length - 1);
    return value >= sign ? value - 2 ** length : value;
  }

  /** Source 1's compact entity-index integer (not protobuf varint). */
  readUBitVar(): number {
    const head = this.readBits(6);
    switch (head & 0x30) {
      case 0x10:
        return (head & 0x0f) | (this.readBits(4) << 4);
      case 0x20:
        return (head & 0x0f) | (this.readBits(8) << 4);
      case 0x30:
        return (head & 0x0f) + this.readBits(28) * 16;
      default:
        return head;
    }
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0)
      throw new RangeError("length must be non-negative");
    const result = new Uint8Array(length);
    for (let index = 0; index < length; index += 1)
      result[index] = this.readBits(8);
    return result;
  }

  readFloat32(): number {
    const bytes = this.readBytes(4);
    return new DataView(bytes.buffer).getFloat32(0, true);
  }

  skipBits(length: number): void {
    this.#require(length, Number.MAX_SAFE_INTEGER);
    this.#bitOffset += length;
  }

  readNullTerminatedString(maxBytes: number): string {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }
    const result: number[] = [];
    for (let index = 0; index < maxBytes; index += 1) {
      const byte = this.readBits(8);
      if (byte === 0)
        return new TextDecoder("latin1").decode(Uint8Array.from(result));
      result.push(byte);
    }
    throw new BitReadError(
      "INVALID_LENGTH",
      `Network string exceeds ${maxBytes} bytes`,
      this.#bitOffset,
      8,
      this.remainingBits,
    );
  }

  #require(length: number, maximum = 32): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
      throw new BitReadError(
        "INVALID_LENGTH",
        `Invalid bit read length ${String(length)}`,
        this.#bitOffset,
        length,
        this.remainingBits,
      );
    }
    if (length > this.remainingBits) {
      throw new BitReadError(
        "OUT_OF_BOUNDS",
        `Need ${length} bits at bit ${this.#bitOffset}, only ${this.remainingBits} remain`,
        this.#bitOffset,
        length,
        this.remainingBits,
      );
    }
  }
}
