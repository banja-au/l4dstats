import { BitReader } from "./bit-reader.js";
import {
  SendPropFlag,
  type FlattenedSendProp,
  type FlattenedServerClass,
} from "./data-tables.js";
import type { DemoStringTable } from "./string-tables.js";

const MAX_EDICTS = 2_048;
const MAX_STRING_BYTES = 512;

export type SendPropValue = number | string | readonly SendPropValue[];

export interface DecodedProperty {
  readonly index: number;
  readonly path: string;
  readonly value: SendPropValue;
}

export interface ClassBaseline {
  readonly classId: number;
  readonly properties: readonly DecodedProperty[];
  readonly consumedBits: number;
  readonly sourceBits: number;
}

export function decodeClassBaseline(
  bytes: Uint8Array,
  serverClass: FlattenedServerClass,
): ClassBaseline {
  const reader = new BitReader(bytes);
  const properties = decodePropertyStream(reader, serverClass.props);
  return {
    classId: serverClass.dataTableId,
    properties,
    consumedBits: reader.bitOffset,
    sourceBits: bytes.byteLength * 8,
  };
}

export function decodeInstanceBaselines(
  table: DemoStringTable,
  classes: readonly FlattenedServerClass[],
): ReadonlyMap<number, ClassBaseline> {
  if (table.name !== "instancebaseline")
    throw new RangeError("expected instancebaseline string table");
  const byId = new Map(
    classes.map((serverClass) => [serverClass.dataTableId, serverClass]),
  );
  const result = new Map<number, ClassBaseline>();
  for (const entry of table.entries) {
    if (entry.data === null) continue;
    if (!/^(0|[1-9][0-9]*)$/.test(entry.name))
      throw new RangeError(`invalid baseline class ID ${entry.name}`);
    const classId = Number(entry.name);
    const serverClass = byId.get(classId);
    if (!serverClass)
      throw new RangeError(`unknown baseline class ID ${classId}`);
    result.set(classId, decodeClassBaseline(entry.data, serverClass));
  }
  return result;
}

export function decodePropertyStream(
  reader: BitReader,
  props: readonly FlattenedSendProp[],
): readonly DecodedProperty[] {
  const newWay = reader.readBoolean();
  const properties: DecodedProperty[] = [];
  let last = -1;
  while (true) {
    const index = readPropertyIndex(reader, last, newWay);
    if (index === -1) break;
    if (index <= last || index >= props.length)
      throw new RangeError(
        `property index ${index} outside ${props.length} at bit ${reader.bitOffset} after ${last}`,
      );
    const flattened = props[index]!;
    properties.push({
      index,
      path: flattened.path,
      value: decodeValue(reader, flattened),
    });
    last = index;
  }
  return properties;
}

export function readPropertyIndexes(
  reader: BitReader,
  propCount: number,
): number[] {
  if (!Number.isSafeInteger(propCount) || propCount < 0 || propCount > 65_536)
    throw new RangeError("invalid flattened property count");
  const newWay = reader.readBoolean();
  const indexes: number[] = [];
  let last = -1;
  while (true) {
    const index = readPropertyIndex(reader, last, newWay);
    if (index === -1) break;
    if (index <= last || index >= propCount)
      throw new RangeError(`property index ${index} outside ${propCount}`);
    indexes.push(index);
    last = index;
  }
  return indexes;
}

function readPropertyIndex(
  reader: BitReader,
  last: number,
  newWay: boolean,
): number {
  if (newWay && reader.readBoolean()) return last + 1;
  let delta: number;
  if (newWay && reader.readBoolean()) delta = reader.readBits(3);
  else {
    delta = reader.readBits(7);
    switch (delta & 0x60) {
      case 0x20:
        delta = (delta & 0x1f) | (reader.readBits(2) << 5);
        break;
      case 0x40:
        delta = (delta & 0x1f) | (reader.readBits(4) << 5);
        break;
      case 0x60:
        delta = (delta & 0x1f) | (reader.readBits(7) << 5);
        break;
    }
  }
  return delta === 4_095 ? -1 : last + delta + 1;
}

function decodeValue(
  reader: BitReader,
  flattened: FlattenedSendProp,
): SendPropValue {
  const prop = flattened.prop;
  switch (prop.type) {
    case 0:
      return decodeInteger(reader, prop.flags, requiredBits(prop.bitCount));
    case 1:
      return decodeFloat(
        reader,
        prop.flags,
        requiredBits(prop.bitCount),
        prop.lowValue,
        prop.highValue,
      );
    case 2: {
      const x = decodeFloat(
        reader,
        prop.flags,
        requiredBits(prop.bitCount),
        prop.lowValue,
        prop.highValue,
      );
      const y = decodeFloat(
        reader,
        prop.flags,
        requiredBits(prop.bitCount),
        prop.lowValue,
        prop.highValue,
      );
      if ((prop.flags & SendPropFlag.Normal) !== 0) {
        const sign = reader.readBoolean() ? -1 : 1;
        return [x, y, sign * Math.sqrt(Math.max(0, 1 - x * x - y * y))];
      }
      return [
        x,
        y,
        decodeFloat(
          reader,
          prop.flags,
          requiredBits(prop.bitCount),
          prop.lowValue,
          prop.highValue,
        ),
      ];
    }
    case 3:
      return [
        decodeFloat(
          reader,
          prop.flags,
          requiredBits(prop.bitCount),
          prop.lowValue,
          prop.highValue,
        ),
        decodeFloat(
          reader,
          prop.flags,
          requiredBits(prop.bitCount),
          prop.lowValue,
          prop.highValue,
        ),
      ];
    case 4: {
      const length = reader.readBits(9);
      if (length >= MAX_STRING_BYTES)
        throw new RangeError("send-prop string limit exceeded");
      return new TextDecoder("latin1").decode(reader.readBytes(length));
    }
    case 5: {
      const element = flattened.arrayElement;
      const max = prop.arrayElements;
      if (!element || max === null || max < 1)
        throw new RangeError("invalid array property");
      const count = reader.readBits(Math.ceil(Math.log2(max + 1)));
      if (count > max)
        throw new RangeError(`array count ${count} exceeds ${max}`);
      return Array.from({ length: count }, () =>
        decodeValue(reader, {
          path: flattened.path,
          prop: element,
          arrayElement: null,
        }),
      );
    }
    default:
      throw new RangeError(`unsupported flattened send-prop type ${prop.type}`);
  }
}

function decodeInteger(reader: BitReader, flags: number, bits: number): number {
  return (flags & SendPropFlag.Unsigned) !== 0
    ? reader.readBits(bits)
    : reader.readSignedBits(bits);
}

function decodeFloat(
  reader: BitReader,
  flags: number,
  bits: number,
  low: number | null,
  high: number | null,
): number {
  if ((flags & SendPropFlag.Coord) !== 0) return readBitCoord(reader);
  if ((flags & SendPropFlag.CoordMp) !== 0)
    return readBitCoordMp(reader, false, false);
  if ((flags & SendPropFlag.CoordMpLowPrecision) !== 0)
    return readBitCoordMp(reader, false, true);
  if ((flags & SendPropFlag.CoordMpIntegral) !== 0)
    return readBitCoordMp(reader, true, false);
  if ((flags & SendPropFlag.CellCoord) !== 0)
    return readBitCellCoord(reader, bits, false, false);
  if ((flags & SendPropFlag.CellCoordLowPrecision) !== 0)
    return readBitCellCoord(reader, bits, false, true);
  if ((flags & SendPropFlag.CellCoordIntegral) !== 0)
    return readBitCellCoord(reader, bits, true, false);
  if ((flags & SendPropFlag.NoScale) !== 0) return reader.readFloat32();
  if ((flags & SendPropFlag.Normal) !== 0) {
    const sign = reader.readBoolean() ? -1 : 1;
    return (sign * reader.readBits(11)) / 2_047;
  }
  if (low === null || high === null)
    throw new RangeError("scaled float has no bounds");
  if (bits === 0) throw new RangeError("scaled float has zero bit count");
  const raw = reader.readBits(bits);
  return low + (high - low) * (raw / (2 ** bits - 1));
}

function readBitCoord(reader: BitReader): number {
  const hasInteger = reader.readBoolean(),
    hasFraction = reader.readBoolean();
  if (!hasInteger && !hasFraction) return 0;
  const negative = reader.readBoolean();
  const integer = hasInteger ? reader.readBits(14) + 1 : 0;
  const fraction = hasFraction ? reader.readBits(5) / 32 : 0;
  return (negative ? -1 : 1) * (integer + fraction);
}

function readBitCoordMp(
  reader: BitReader,
  integral: boolean,
  lowPrecision: boolean,
): number {
  const inBounds = reader.readBoolean();
  const hasInteger = reader.readBoolean();
  if (integral && !hasInteger) return 0;
  const negative = reader.readBoolean();
  const integer = hasInteger ? reader.readBits(inBounds ? 11 : 14) + 1 : 0;
  const fraction = integral
    ? 0
    : reader.readBits(lowPrecision ? 3 : 5) / (lowPrecision ? 8 : 32);
  return (negative ? -1 : 1) * (integer + fraction);
}

function readBitCellCoord(
  reader: BitReader,
  bits: number,
  integral: boolean,
  lowPrecision: boolean,
): number {
  const integer = reader.readBits(bits);
  if (integral) return integer;
  return (
    integer + reader.readBits(lowPrecision ? 3 : 5) / (lowPrecision ? 8 : 32)
  );
}

function requiredBits(bits: number | null): number {
  if (bits === null || bits < 0 || bits > 32)
    throw new RangeError(`invalid send-prop bit count ${bits}`);
  return bits;
}

export type EntityUpdateKind = "enter" | "delta" | "leave" | "delete";
export interface PacketEntityUpdate {
  readonly entityIndex: number;
  readonly kind: EntityUpdateKind;
  readonly classId: number | null;
  readonly serial: number | null;
  readonly properties: readonly DecodedProperty[];
}

export interface PacketEntitiesEnvelope {
  readonly maxEntries: number;
  readonly isDelta: boolean;
  readonly deltaFrom: number | null;
  readonly baseline: 0 | 1;
  readonly updatedEntries: number;
  readonly updateBaseline: boolean;
  readonly dataBitLength: number;
  readonly data: Uint8Array;
}

/** Decodes a complete svc_PacketEntities message, including its six-bit ID. */
export function decodePacketEntitiesEnvelope(
  bytes: Uint8Array,
): PacketEntitiesEnvelope {
  const reader = new BitReader(bytes);
  if (reader.readBits(6) !== 26)
    throw new RangeError("payload does not start with svc_PacketEntities");
  const maxEntries = reader.readBits(11);
  const isDelta = reader.readBoolean();
  const deltaFrom = isDelta ? reader.readBits(32) : null;
  const baseline = reader.readBits(1) as 0 | 1;
  const updatedEntries = reader.readBits(11);
  const dataBitLength = reader.readBits(20);
  const updateBaseline = reader.readBoolean();
  if (maxEntries > MAX_EDICTS || updatedEntries > maxEntries)
    throw new RangeError("invalid packet entity bounds");
  if (dataBitLength > reader.remainingBits)
    throw new RangeError("packet entity data exceeds payload");
  const data = new Uint8Array(Math.ceil(dataBitLength / 8));
  for (let bit = 0; bit < dataBitLength; bit += 1) {
    const byte = bit >>> 3;
    data[byte] = data[byte]! | (reader.readBits(1) << (bit & 7));
  }
  return {
    maxEntries,
    isDelta,
    deltaFrom,
    baseline,
    updatedEntries,
    updateBaseline,
    dataBitLength,
    data,
  };
}

/** Decodes the bit payload nested inside svc_PacketEntities. */
export function decodePacketEntityData(
  bytes: Uint8Array,
  updatedEntries: number,
  classes: readonly FlattenedServerClass[],
  classByEntity: ReadonlyMap<number, number>,
  options: PacketEntityDataOptions = {},
): readonly PacketEntityUpdate[] {
  if (
    !Number.isSafeInteger(updatedEntries) ||
    updatedEntries < 0 ||
    updatedEntries > MAX_EDICTS
  )
    throw new RangeError("invalid updated entity count");
  const reader = new BitReader(bytes);
  const classBits = Math.ceil(Math.log2(classes.length));
  const byId = new Map(
    classes.map((serverClass) => [serverClass.dataTableId, serverClass]),
  );
  const updates: PacketEntityUpdate[] = [];
  let entityIndex = -1;
  for (let count = 0; count < updatedEntries; count += 1) {
    entityIndex += reader.readUBitVar() + 1;
    if (entityIndex >= MAX_EDICTS)
      throw new RangeError(`entity index ${entityIndex} exceeds limit`);
    if (reader.readBoolean()) {
      updates.push({
        entityIndex,
        kind: reader.readBoolean() ? "delete" : "leave",
        classId: null,
        serial: null,
        properties: [],
      });
      continue;
    }
    if (reader.readBoolean()) {
      const classId = reader.readBits(classBits),
        serial = reader.readBits(10);
      const serverClass = byId.get(classId);
      if (!serverClass) throw new RangeError(`unknown entity class ${classId}`);
      updates.push({
        entityIndex,
        kind: "enter",
        classId,
        serial,
        properties: decodePropertyStream(reader, serverClass.props),
      });
      continue;
    }
    const classId = classByEntity.get(entityIndex);
    if (classId === undefined)
      throw new RangeError(`delta for unknown entity ${entityIndex}`);
    const serverClass = byId.get(classId);
    if (!serverClass) throw new RangeError(`unknown entity class ${classId}`);
    updates.push({
      entityIndex,
      kind: "delta",
      classId,
      serial: null,
      properties: decodePropertyStream(reader, serverClass.props),
    });
  }
  // L4D2 builds >= 2091 append a UBitVar count followed by delta-coded UBitVar
  // indexes on delta packets. Keep this opt-in because older Source branches
  // use a sentinel encoding and byte padding is otherwise ambiguous.
  if (options.explicitDeletionList) {
    if (options.isDelta !== true)
      throw new RangeError("L4D2 explicit deletions require a delta packet");
    const bitLength = options.dataBitLength ?? bytes.byteLength * 8;
    if (bitLength < reader.bitOffset || bitLength > bytes.byteLength * 8)
      throw new RangeError("invalid packet entity data bit length");
    const deletionCount = readBoundedUBitVar(reader, bitLength);
    if (deletionCount > (options.maxEntries ?? MAX_EDICTS))
      throw new RangeError("explicit entity deletion count exceeds limit");
    let deletedIndex = -1;
    for (let count = 0; count < deletionCount; count += 1) {
      deletedIndex += readBoundedUBitVar(reader, bitLength);
      if (deletedIndex >= (options.maxEntries ?? MAX_EDICTS))
        throw new RangeError(
          `deleted entity index ${deletedIndex} exceeds limit`,
        );
      updates.push({
        entityIndex: deletedIndex,
        kind: "delete",
        classId: null,
        serial: null,
        properties: [],
      });
    }
    if (reader.bitOffset !== bitLength)
      throw new RangeError("explicit deletion list has trailing bits");
  }
  return updates;
}

export interface PacketEntityDataOptions {
  /** Required for L4D2 (engine build >= 2091). */
  readonly explicitDeletionList?: boolean;
  /** Explicit deletions exist only on delta PacketEntities messages. */
  readonly isDelta?: boolean;
  /** Exact nested payload length; prevents treating byte padding as protocol. */
  readonly dataBitLength?: number;
  readonly maxEntries?: number;
}

function readBoundedUBitVar(reader: BitReader, bitLength: number): number {
  if (bitLength - reader.bitOffset < 6)
    throw new RangeError("truncated explicit entity deletion integer");
  const head = reader.readBits(6);
  const tailBits = [0, 4, 8, 28][head >>> 4]!;
  if (bitLength - reader.bitOffset < tailBits)
    throw new RangeError("truncated explicit entity deletion integer");
  return (head & 0x0f) + reader.readBits(tailBits) * 16;
}

export interface EntitySnapshot {
  readonly entityIndex: number;
  readonly classId: number;
  readonly serial: number;
  readonly lifetime: number;
  readonly active: boolean;
  readonly properties: ReadonlyMap<string, SendPropValue>;
}

export interface EntityFrame {
  readonly sequence: number;
  readonly entities: ReadonlyMap<number, EntitySnapshot>;
}

export interface EntityReconstructorOptions {
  readonly maxEntries?: number;
  readonly maxHistory?: number;
  readonly instanceBaselines?: ReadonlyMap<number, ClassBaseline>;
}

/**
 * Bounded state machine for decoded PacketEntities updates.
 *
 * It deliberately accepts decoded updates: transport/framing can be validated
 * independently, and callers cannot accidentally turn absent telemetry into
 * zeroes. Frames and dynamic baselines are immutable snapshots.
 */
export class EntityReconstructor {
  readonly #maxEntries: number;
  readonly #maxHistory: number;
  readonly #instanceBaselines: ReadonlyMap<number, ClassBaseline>;
  readonly #frames = new Map<number, EntityFrame>();
  readonly #dynamicBaselines: [
    Map<number, DynamicEntityBaseline>,
    Map<number, DynamicEntityBaseline>,
  ] = [new Map(), new Map()];
  #nextLifetime = 1;

  constructor(options: EntityReconstructorOptions = {}) {
    this.#maxEntries = options.maxEntries ?? MAX_EDICTS;
    this.#maxHistory = options.maxHistory ?? 64;
    if (
      !Number.isSafeInteger(this.#maxEntries) ||
      this.#maxEntries < 1 ||
      this.#maxEntries > MAX_EDICTS
    )
      throw new RangeError("invalid entity-state maximum");
    if (!Number.isSafeInteger(this.#maxHistory) || this.#maxHistory < 1)
      throw new RangeError("invalid entity-state history limit");
    this.#instanceBaselines = options.instanceBaselines ?? new Map();
  }

  getFrame(sequence: number): EntityFrame | undefined {
    return this.#frames.get(sequence);
  }

  applyPacket(
    sequence: number,
    envelope: Pick<
      PacketEntitiesEnvelope,
      "isDelta" | "deltaFrom" | "baseline" | "updateBaseline" | "maxEntries"
    >,
    updates: readonly PacketEntityUpdate[],
  ): EntityFrame {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new RangeError("invalid packet sequence");
    if (this.#frames.has(sequence))
      throw new RangeError(`duplicate packet sequence ${sequence}`);
    if (
      !Number.isSafeInteger(envelope.maxEntries) ||
      envelope.maxEntries < 1 ||
      envelope.maxEntries > this.#maxEntries
    )
      throw new RangeError("packet exceeds configured entity maximum");
    if (envelope.baseline !== 0 && envelope.baseline !== 1)
      throw new RangeError("invalid dynamic baseline slot");

    let entities: Map<number, EntitySnapshot>;
    if (envelope.isDelta) {
      if (envelope.deltaFrom === null)
        throw new RangeError("delta packet has no source sequence");
      const source = this.#frames.get(envelope.deltaFrom);
      if (!source)
        throw new RangeError(`missing delta frame ${envelope.deltaFrom}`);
      entities = cloneEntities(source.entities);
    } else {
      entities = new Map();
    }

    const touched = new Set<number>();
    for (const update of updates) {
      if (
        !Number.isSafeInteger(update.entityIndex) ||
        update.entityIndex < 0 ||
        update.entityIndex >= envelope.maxEntries ||
        update.entityIndex >= this.#maxEntries
      )
        throw new RangeError(
          `entity index ${update.entityIndex} exceeds state bounds`,
        );
      if (touched.has(update.entityIndex) && update.kind !== "delete")
        throw new RangeError(
          `duplicate update for entity ${update.entityIndex}`,
        );
      touched.add(update.entityIndex);
      const current = entities.get(update.entityIndex);

      if (update.kind === "delete") {
        entities.delete(update.entityIndex);
        continue;
      }
      if (update.kind === "leave") {
        if (!current)
          throw new RangeError(
            `leave for unknown entity ${update.entityIndex}`,
          );
        entities.set(update.entityIndex, { ...current, active: false });
        continue;
      }
      if (update.kind === "delta") {
        if (!current || !current.active)
          throw new RangeError(
            `delta for inactive entity ${update.entityIndex}`,
          );
        if (update.classId !== null && update.classId !== current.classId)
          throw new RangeError(
            `delta class mismatch for entity ${update.entityIndex}`,
          );
        entities.set(
          update.entityIndex,
          mergeSnapshot(current, update.properties),
        );
        continue;
      }

      if (update.classId === null || update.serial === null)
        throw new RangeError(
          `enter lacks class or serial for entity ${update.entityIndex}`,
        );
      const resumed =
        current?.serial === update.serial && current.classId === update.classId;
      const dynamic = this.#dynamicBaselines[envelope.baseline].get(
        update.entityIndex,
      );
      const seed =
        envelope.isDelta && dynamic?.classId === update.classId
          ? dynamic.properties
          : baselineProperties(this.#instanceBaselines.get(update.classId));
      const entered: EntitySnapshot = {
        entityIndex: update.entityIndex,
        classId: update.classId,
        serial: update.serial,
        lifetime: resumed ? current.lifetime : this.#nextLifetime++,
        active: true,
        properties: mergeProperties(seed, update.properties),
      };
      entities.set(update.entityIndex, entered);
      // The protocol refreshes the opposite slot only for EnterPVS entities.
      // It contains class/property state, not a lifetime or serial identity.
      if (envelope.updateBaseline)
        this.#dynamicBaselines[envelope.baseline === 0 ? 1 : 0].set(
          update.entityIndex,
          {
            classId: entered.classId,
            properties: new Map(entered.properties),
          },
        );
    }

    const frame: EntityFrame = { sequence, entities };
    this.#frames.set(sequence, frame);
    while (this.#frames.size > this.#maxHistory) {
      const oldest = this.#frames.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.#frames.delete(oldest);
    }
    return frame;
  }
}

interface DynamicEntityBaseline {
  readonly classId: number;
  readonly properties: ReadonlyMap<string, SendPropValue>;
}

function baselineProperties(
  baseline: ClassBaseline | undefined,
): ReadonlyMap<string, SendPropValue> {
  return mergeProperties(new Map(), baseline?.properties ?? []);
}

function mergeProperties(
  base: ReadonlyMap<string, SendPropValue>,
  updates: readonly DecodedProperty[],
): ReadonlyMap<string, SendPropValue> {
  const result = new Map(base);
  for (const property of updates) result.set(property.path, property.value);
  return result;
}

function mergeSnapshot(
  snapshot: EntitySnapshot,
  updates: readonly DecodedProperty[],
): EntitySnapshot {
  return {
    ...snapshot,
    properties: mergeProperties(snapshot.properties, updates),
  };
}

function cloneEntities(
  entities: ReadonlyMap<number, EntitySnapshot>,
): Map<number, EntitySnapshot> {
  // Entity snapshots and their property maps are replaced, never mutated, so
  // structural sharing keeps per-tick delta reconstruction bounded to touched
  // entities instead of cloning the entire world state.
  return new Map(entities);
}
