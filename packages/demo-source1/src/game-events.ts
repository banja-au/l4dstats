import { BitReader } from "./bit-reader.js";

export const gameEventFieldTypes = {
  string: 1,
  float: 2,
  long: 3,
  short: 4,
  byte: 5,
  boolean: 6,
  uint64: 7,
} as const;

export type GameEventFieldType = keyof typeof gameEventFieldTypes;
export type GameEventValue = boolean | number | string;

export interface GameEventFieldSchema {
  readonly name: string;
  readonly type: GameEventFieldType;
}

export interface GameEventSchema {
  readonly id: number;
  readonly name: string;
  readonly fields: readonly GameEventFieldSchema[];
}

export interface DecodedGameEvent {
  readonly id: number;
  readonly name: string;
  readonly fields: Readonly<Record<string, GameEventValue>>;
  readonly schema: GameEventSchema;
}

export interface GameEventDecodeLimits {
  readonly maxEvents?: number;
  readonly maxFieldsPerEvent?: number;
  readonly maxStringBytes?: number;
}

export interface EventFieldAvailability<T extends GameEventValue> {
  readonly availability: "observed" | "unavailable";
  readonly value?: T;
  readonly provenance?: {
    readonly message: "svc_GameEvent";
    readonly eventId: number;
    readonly field: string;
  };
  readonly reason?: string;
}

export type RequiredGameEventName =
  | "weapon_fire"
  | "player_hurt"
  | "player_death";

export interface RequiredGameEventProjection {
  readonly name: RequiredGameEventName;
  readonly eventId: number;
  readonly tick: number;
  readonly actorUserId: EventFieldAvailability<number>;
  readonly victimUserId: EventFieldAvailability<number>;
  readonly attackerUserId: EventFieldAvailability<number>;
  readonly weapon: EventFieldAvailability<string>;
  readonly damage: EventFieldAvailability<number>;
  readonly health: EventFieldAvailability<number>;
  readonly decoded: DecodedGameEvent;
}

/** Decodes the bounded payload of svc_GameEventList for L4D2 protocol 2100. */
export function decodeL4d2GameEventList(
  bytes: Uint8Array,
  bitLength: number,
  eventCount: number,
  limits: GameEventDecodeLimits = {},
): readonly GameEventSchema[] {
  const maxEvents = positiveLimit(limits.maxEvents, 512, "maxEvents");
  const maxFields = positiveLimit(
    limits.maxFieldsPerEvent,
    128,
    "maxFieldsPerEvent",
  );
  const maxStringBytes = positiveLimit(
    limits.maxStringBytes,
    4_096,
    "maxStringBytes",
  );
  requireBitLength(bytes, bitLength);
  if (
    !Number.isSafeInteger(eventCount) ||
    eventCount < 0 ||
    eventCount > maxEvents
  )
    throw new RangeError(`game event count ${eventCount} is invalid`);
  const reader = new BitReader(bytes);
  const schemas: GameEventSchema[] = [];
  const ids = new Set<number>();
  for (let index = 0; index < eventCount; index += 1) {
    requireWithin(reader, bitLength, 9);
    const id = reader.readBits(9);
    if (ids.has(id)) throw new RangeError(`duplicate game event id ${id}`);
    ids.add(id);
    const name = readBoundedString(reader, bitLength, maxStringBytes);
    const fields: GameEventFieldSchema[] = [];
    while (true) {
      requireWithin(reader, bitLength, 3);
      const typeId = reader.readBits(3);
      if (typeId === 0) break;
      if (fields.length >= maxFields)
        throw new RangeError(`game event ${id} field limit exceeded`);
      const type = fieldType(typeId);
      const fieldName = readBoundedString(reader, bitLength, maxStringBytes);
      if (fieldName === "")
        throw new RangeError(`game event ${id} has an empty field name`);
      if (fields.some(({ name: value }) => value === fieldName))
        throw new RangeError(`game event ${id} repeats field ${fieldName}`);
      fields.push({ name: fieldName, type });
    }
    schemas.push({ id, name, fields });
  }
  if (reader.bitOffset !== bitLength)
    throw new RangeError(
      `game event list consumed ${reader.bitOffset} of ${bitLength} bits`,
    );
  return schemas;
}

/** Decodes one bounded svc_GameEvent payload using its preceding list schema. */
export function decodeL4d2GameEvent(
  bytes: Uint8Array,
  bitLength: number,
  schemas: ReadonlyMap<number, GameEventSchema>,
  limits: GameEventDecodeLimits = {},
): DecodedGameEvent {
  const maxStringBytes = positiveLimit(
    limits.maxStringBytes,
    4_096,
    "maxStringBytes",
  );
  requireBitLength(bytes, bitLength);
  const reader = new BitReader(bytes);
  requireWithin(reader, bitLength, 9);
  const id = reader.readBits(9);
  const schema = schemas.get(id);
  if (!schema)
    throw new RangeError(`game event ${id} has no registered schema`);
  const fields: Record<string, GameEventValue> = {};
  for (const field of schema.fields) {
    fields[field.name] = readValue(
      reader,
      bitLength,
      field.type,
      maxStringBytes,
    );
  }
  if (reader.bitOffset !== bitLength)
    throw new RangeError(
      `game event ${id} consumed ${reader.bitOffset} of ${bitLength} bits`,
    );
  return { id, name: schema.name, fields, schema };
}

/** Retains only the latest bounded schema registry while streaming a demo. */
export class L4d2GameEventDecoder {
  readonly #limits: GameEventDecodeLimits;
  #schemas = new Map<number, GameEventSchema>();

  constructor(limits: GameEventDecodeLimits = {}) {
    this.#limits = limits;
  }

  get schemas(): ReadonlyMap<number, GameEventSchema> {
    return this.#schemas;
  }

  registerList(bytes: Uint8Array, bitLength: number, eventCount: number): void {
    const decoded = decodeL4d2GameEventList(
      bytes,
      bitLength,
      eventCount,
      this.#limits,
    );
    this.#schemas = new Map(decoded.map((schema) => [schema.id, schema]));
  }

  decode(bytes: Uint8Array, bitLength: number): DecodedGameEvent {
    return decodeL4d2GameEvent(bytes, bitLength, this.#schemas, this.#limits);
  }
}

/** Projects only review-relevant events; absent protocol fields stay explicit. */
export function projectRequiredGameEvent(
  event: DecodedGameEvent,
  tick: number,
): RequiredGameEventProjection | null {
  if (!isRequiredName(event.name)) return null;
  return {
    name: event.name,
    eventId: event.id,
    tick,
    actorUserId: numberField(event, "userid"),
    victimUserId:
      event.name === "player_hurt" || event.name === "player_death"
        ? numberField(event, "userid")
        : unavailable("event has no victim role"),
    attackerUserId:
      event.name === "player_hurt" || event.name === "player_death"
        ? numberField(event, "attacker")
        : unavailable("event has no attacker role"),
    weapon: stringField(event, "weapon"),
    damage:
      event.name === "player_hurt"
        ? numberField(event, "dmg_health")
        : unavailable("event has no damage field"),
    health:
      event.name === "player_hurt"
        ? numberField(event, "health")
        : unavailable("event has no health field"),
    decoded: event,
  };
}

function numberField(
  event: DecodedGameEvent,
  field: string,
): EventFieldAvailability<number> {
  const value = event.fields[field];
  return typeof value === "number"
    ? observed(event, field, value)
    : unavailable(`schema does not expose numeric ${field}`);
}

function stringField(
  event: DecodedGameEvent,
  field: string,
): EventFieldAvailability<string> {
  const value = event.fields[field];
  return typeof value === "string"
    ? observed(event, field, value)
    : unavailable(`schema does not expose string ${field}`);
}

function observed<T extends GameEventValue>(
  event: DecodedGameEvent,
  field: string,
  value: T,
): EventFieldAvailability<T> {
  return {
    availability: "observed",
    value,
    provenance: { message: "svc_GameEvent", eventId: event.id, field },
  };
}

function unavailable<T extends GameEventValue>(
  reason: string,
): EventFieldAvailability<T> {
  return { availability: "unavailable", reason };
}

function readValue(
  reader: BitReader,
  bitLength: number,
  type: GameEventFieldType,
  maxStringBytes: number,
): GameEventValue {
  switch (type) {
    case "string":
      return readBoundedString(reader, bitLength, maxStringBytes);
    case "float":
      requireWithin(reader, bitLength, 32);
      return reader.readFloat32();
    case "long":
      requireWithin(reader, bitLength, 32);
      return reader.readSignedBits(32);
    case "short":
      requireWithin(reader, bitLength, 16);
      return reader.readSignedBits(16);
    case "byte":
      requireWithin(reader, bitLength, 8);
      return reader.readBits(8);
    case "boolean":
      requireWithin(reader, bitLength, 1);
      return reader.readBoolean();
    case "uint64": {
      requireWithin(reader, bitLength, 64);
      const low = BigInt(reader.readBits(32));
      const high = BigInt(reader.readBits(32));
      return ((high << 32n) | low).toString(10);
    }
  }
}

function readBoundedString(
  reader: BitReader,
  bitLength: number,
  maxBytes: number,
): string {
  const availableBytes = Math.floor((bitLength - reader.bitOffset) / 8);
  if (availableBytes <= 0)
    throw new RangeError("game event string is truncated");
  return reader.readNullTerminatedString(Math.min(maxBytes, availableBytes));
}

function requireWithin(
  reader: BitReader,
  bitLength: number,
  bits: number,
): void {
  if (reader.bitOffset + bits > bitLength)
    throw new RangeError("game event payload exceeds its declared bit length");
}

function requireBitLength(bytes: Uint8Array, bitLength: number): void {
  if (
    !Number.isSafeInteger(bitLength) ||
    bitLength < 0 ||
    bitLength > bytes.byteLength * 8
  )
    throw new RangeError(`game event bit length ${bitLength} is invalid`);
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new RangeError(`${name} must be a positive safe integer`);
  return result;
}

function fieldType(id: number): GameEventFieldType {
  const entry = Object.entries(gameEventFieldTypes).find(
    ([, value]) => value === id,
  );
  if (!entry) throw new RangeError(`unsupported game event field type ${id}`);
  return entry[0] as GameEventFieldType;
}

function isRequiredName(value: string): value is RequiredGameEventName {
  return (
    value === "weapon_fire" ||
    value === "player_hurt" ||
    value === "player_death"
  );
}
