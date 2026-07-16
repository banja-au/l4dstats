import { describe, expect, it } from "vitest";
import { decodeDemo } from "./decode";
import { DemoParseError } from "./types";

class FixtureWriter {
  readonly bytes: number[] = [];

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  i32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    this.bytes.push(...bytes);
    return this;
  }

  f32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    this.bytes.push(...bytes);
    return this;
  }

  fixed(value: string, length: number): this {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > length) throw new Error("fixture string too long");
    this.bytes.push(...bytes, ...Array<number>(length - bytes.length).fill(0));
    return this;
  }

  raw(...values: number[]): this {
    this.bytes.push(...values);
    return this;
  }

  result(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function header(protocol = 4): FixtureWriter {
  return new FixtureWriter()
    .fixed("HL2DEMO", 8)
    .i32(protocol)
    .i32(2_042)
    .fixed("CEDAPug server", 260)
    .fixed("SourceTV", 260)
    .fixed("c5m1_waterfront", 260)
    .fixed("left4dead2", 260)
    .f32(12.5)
    .i32(375)
    .i32(380)
    .i32(42);
}

function framePrefix(
  writer: FixtureWriter,
  command: number,
  tick: number,
): void {
  writer.u8(command).i32(tick).u8(0);
}

function stopFrame(writer: FixtureWriter, tick: number): void {
  writer.u8(7).i32(tick);
}

function packetCommandInfo(writer: FixtureWriter): void {
  // L4D protocol 4 stores four split-screen command-info blocks. Each is flags plus
  // six vectors (19 little-endian 32-bit values, 76 bytes).
  for (let split = 0; split < 4; split += 1) {
    writer.i32(split);
    for (let component = 0; component < 18; component += 1) {
      writer.f32(split * 100 + component);
    }
  }
}

function expectParseError(
  bytes: Uint8Array,
  code: DemoParseError["code"],
): void {
  try {
    decodeDemo(bytes);
    throw new Error("expected decodeDemo to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(DemoParseError);
    expect((error as DemoParseError).code).toBe(code);
  }
}

describe("decodeDemo", () => {
  it("decodes the fixed header and framed protocol-4 command stream", () => {
    const fixture = header();
    framePrefix(fixture, 2, 10);
    packetCommandInfo(fixture);
    fixture.i32(40).i32(41).i32(3).raw(0xaa, 0xbb, 0xcc);
    framePrefix(fixture, 5, 11);
    fixture.i32(99).i32(2).raw(1, 2);
    framePrefix(fixture, 4, 12);
    fixture.i32(3).raw(102, 111, 111);
    stopFrame(fixture, 13);

    const decoded = decodeDemo(fixture.result());

    expect(decoded.header).toEqual({
      stamp: "HL2DEMO",
      demoProtocol: 4,
      networkProtocol: 2_042,
      serverName: "CEDAPug server",
      clientName: "SourceTV",
      mapName: "c5m1_waterfront",
      gameDirectory: "left4dead2",
      playbackTimeSeconds: 12.5,
      playbackTicks: 375,
      playbackFrames: 380,
      signonLength: 42,
    });
    expect(decoded.frames.map(({ kind, tick }) => ({ kind, tick }))).toEqual([
      { kind: "packet", tick: 10 },
      { kind: "user-command", tick: 11 },
      { kind: "console-command", tick: 12 },
      { kind: "stop", tick: 13 },
    ]);
    expect(decoded.frames[0]?.commandInfo).toHaveLength(4);
    expect(decoded.frames[0]?.commandInfo?.[1]?.viewOrigin.x).toBe(100);
    expect(decoded.frames[0]?.sequenceIn).toBe(40);
    expect(decoded.frames[0]?.payload).toEqual(Uint8Array.of(0xaa, 0xbb, 0xcc));
    expect(decoded.frames[1]?.outgoingSequence).toBe(99);
    expect(decoded.stopped).toBe(true);
    expect(decoded.issues).toEqual([]);
    expect(decoded.bytesConsumed).toBe(fixture.result().byteLength);
  });

  it("uses protocol-3 framing without a player slot and with one command-info block", () => {
    const fixture = header(3);
    fixture.u8(1).i32(5);
    for (let value = 0; value < 19; value += 1) fixture.i32(value);
    fixture.i32(1).i32(2).i32(0);
    fixture.u8(7).i32(6);

    const decoded = decodeDemo(fixture.result());

    expect(decoded.frames[0]?.playerSlot).toBeNull();
    expect(decoded.frames[0]?.commandInfo).toHaveLength(1);
    expect(decoded.frames[1]?.kind).toBe("stop");
  });

  it("reports an unknown command without guessing its frame length", () => {
    const fixture = header();
    fixture.u8(255).raw(1, 2, 3, 4);

    const decoded = decodeDemo(fixture.result());

    expect(decoded.frames).toEqual([]);
    expect(decoded.issues).toEqual([
      {
        code: "UNKNOWN_DEMO_COMMAND",
        offset: 1_072,
        command: 255,
        message:
          "Unknown demo command 255; remaining bytes cannot be framed safely",
      },
    ]);
    expect(decoded.bytesConsumed).toBe(1_073);
  });

  it("reports bytes after stop rather than interpreting them as commands", () => {
    const fixture = header();
    stopFrame(fixture, 1);
    fixture.raw(9, 9);

    const decoded = decodeDemo(fixture.result());

    expect(decoded.issues[0]).toMatchObject({
      code: "TRAILING_DATA",
      offset: 1_077,
    });
    expect(decoded.bytesConsumed).toBe(1_077);
  });

  it("accepts an old-engine stop marker with no tick", () => {
    const fixture = header(3).u8(7);

    const decoded = decodeDemo(fixture.result());

    expect(decoded.frames).toEqual([
      {
        command: 7,
        kind: "stop",
        tick: null,
        playerSlot: null,
        offset: 1_072,
      },
    ]);
    expect(decoded.stopped).toBe(true);
    expect(decoded.issues).toEqual([]);
  });

  it("rejects truncated inputs at every byte boundary deterministically", () => {
    const fixture = header();
    framePrefix(fixture, 4, 20);
    fixture.i32(4).raw(1, 2, 3, 4);
    const complete = fixture.result();

    for (let length = 0; length < complete.byteLength; length += 1) {
      // A header-only stream is structurally valid even though it lacks a stop
      // command; the result's `stopped` field makes that incompleteness explicit.
      if (length === 1_072) continue;
      expectParseError(complete.subarray(0, length), "TRUNCATED");
    }
    expect(decodeDemo(complete).frames).toHaveLength(1);
  });

  it("rejects corrupt lengths and observes resource limits before payload reads", () => {
    const negative = header();
    framePrefix(negative, 6, 1);
    negative.i32(-1);
    expectParseError(negative.result(), "INVALID_PAYLOAD_LENGTH");

    const oversized = header();
    framePrefix(oversized, 9, 1);
    oversized.i32(5);
    expect(() =>
      decodeDemo(oversized.result(), { maxPayloadBytes: 4 }),
    ).toThrow(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE", offset: 1_078 }),
    );
    expect(() =>
      decodeDemo(header().result(), { maxInputBytes: 1_071 }),
    ).toThrow(expect.objectContaining({ code: "INPUT_TOO_LARGE" }));
  });

  it("rejects invalid stamps, protocols, headers, limits, and command floods", () => {
    const badStamp = header().result();
    badStamp[0] = 0;
    expectParseError(badStamp, "INVALID_STAMP");

    expectParseError(header(5).result(), "UNSUPPORTED_DEMO_PROTOCOL");

    const badHeader = header().result();
    new DataView(badHeader.buffer).setInt32(1_064, -1, true);
    expectParseError(badHeader, "INVALID_HEADER");

    expect(() => decodeDemo(header().result(), { maxCommands: 0 })).toThrow(
      RangeError,
    );

    const commands = header();
    framePrefix(commands, 3, 1);
    framePrefix(commands, 3, 2);
    expect(() => decodeDemo(commands.result(), { maxCommands: 1 })).toThrow(
      expect.objectContaining({ code: "COMMAND_LIMIT", offset: 1_078 }),
    );
  });

  it("is byte-deterministic for repeated parses and retains zero-copy payloads", () => {
    const fixture = header();
    framePrefix(fixture, 4, 2);
    fixture.i32(2).raw(1, 2);
    const bytes = fixture.result();

    const first = decodeDemo(bytes);
    const second = decodeDemo(bytes);

    expect(first).toEqual(second);
    bytes[bytes.length - 1] = 7;
    expect(first.frames[0]?.payload?.[1]).toBe(7);
  });
});
