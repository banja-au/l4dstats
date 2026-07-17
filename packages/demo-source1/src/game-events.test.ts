import { describe, expect, it } from "vitest";
import {
  decodeL4d2GameEvent,
  decodeL4d2GameEventList,
  projectRequiredGameEvent,
} from "./game-events";

class Bits {
  readonly values: number[] = [];
  write(value: number, width: number): this {
    for (let bit = 0; bit < width; bit += 1)
      this.values.push(Math.floor(value / 2 ** bit) & 1);
    return this;
  }
  string(value: string): this {
    for (const byte of new TextEncoder().encode(`${value}\0`))
      this.write(byte, 8);
    return this;
  }
  bytes(): Uint8Array {
    const result = new Uint8Array(Math.ceil(this.values.length / 8));
    this.values.forEach((value, bit) => {
      result[bit >>> 3] = result[bit >>> 3]! | (value << (bit & 7));
    });
    return result;
  }
}

function schemaFixture(): Bits {
  return new Bits()
    .write(17, 9)
    .string("player_hurt")
    .write(3, 3)
    .string("userid")
    .write(3, 3)
    .string("attacker")
    .write(5, 3)
    .string("health")
    .write(5, 3)
    .string("dmg_health")
    .write(0, 3);
}

describe("L4D2 game events", () => {
  it("decodes an event list and values using the registered field order", () => {
    const list = schemaFixture();
    const schemas = decodeL4d2GameEventList(
      list.bytes(),
      list.values.length,
      1,
    );
    expect(schemas[0]).toEqual({
      id: 17,
      name: "player_hurt",
      fields: [
        { name: "userid", type: "long" },
        { name: "attacker", type: "long" },
        { name: "health", type: "byte" },
        { name: "dmg_health", type: "byte" },
      ],
    });
    const payload = new Bits()
      .write(17, 9)
      .write(42, 32)
      .write(7, 32)
      .write(61, 8)
      .write(19, 8);
    const decoded = decodeL4d2GameEvent(
      payload.bytes(),
      payload.values.length,
      new Map(schemas.map((schema) => [schema.id, schema])),
    );
    expect(decoded.fields).toEqual({
      userid: 42,
      attacker: 7,
      health: 61,
      dmg_health: 19,
    });
    const projected = projectRequiredGameEvent(decoded, 1234);
    expect(projected?.victimUserId).toMatchObject({
      availability: "observed",
      value: 42,
      provenance: { message: "svc_GameEvent", eventId: 17, field: "userid" },
    });
    expect(projected?.weapon).toEqual({
      availability: "unavailable",
      reason: "schema does not expose string weapon",
    });
  });

  it("fails closed for corrupt lengths, unknown schemas, and resource limits", () => {
    const list = schemaFixture();
    expect(() =>
      decodeL4d2GameEventList(list.bytes(), list.values.length - 1, 1),
    ).toThrow();
    expect(() =>
      decodeL4d2GameEventList(list.bytes(), list.values.length, 1, {
        maxFieldsPerEvent: 2,
      }),
    ).toThrow("field limit");
    const event = new Bits().write(511, 9);
    expect(() =>
      decodeL4d2GameEvent(event.bytes(), event.values.length, new Map()),
    ).toThrow("no registered schema");
  });
});
