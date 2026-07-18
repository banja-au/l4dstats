import { BitReader } from "./bit-reader.js";

export interface SendPropSchema {
  readonly type: number;
  readonly name: string;
  readonly flags: number;
  readonly priority: number;
  readonly dataTableName: string | null;
  readonly lowValue: number | null;
  readonly highValue: number | null;
  readonly bitCount: number | null;
  readonly arrayElements: number | null;
}
export interface SendTableSchema {
  readonly name: string;
  readonly needsDecoder: boolean;
  readonly props: readonly SendPropSchema[];
}
export interface ServerClassSchema {
  readonly dataTableId: number;
  readonly className: string;
  readonly dataTableName: string;
}
export interface DataTableSchema {
  readonly tables: readonly SendTableSchema[];
  readonly serverClasses: readonly ServerClassSchema[];
  readonly consumedBits: number;
}

export function decodeL4d2DataTables(payload: Uint8Array): DataTableSchema {
  const r = new BitReader(payload);
  const tables: SendTableSchema[] = [];
  while (r.readBoolean()) {
    if (tables.length >= 4096)
      throw new RangeError("send-table limit exceeded");
    const needsDecoder = r.readBoolean(),
      name = r.readNullTerminatedString(16384),
      count = r.readBits(10);
    const props: SendPropSchema[] = [];
    for (let i = 0; i < count; i++) {
      const type = r.readBits(5);
      if (type > 6) throw new RangeError(`unsupported send-prop type ${type}`);
      const propName = r.readNullTerminatedString(16384),
        flags = r.readBits(19),
        priority = r.readBits(8);
      let dataTableName: string | null = null;
      let lowValue: number | null = null,
        highValue: number | null = null,
        bitCount: number | null = null,
        arrayElements: number | null = null;
      if (type === 6 || (flags & (1 << 6)) !== 0)
        dataTableName = r.readNullTerminatedString(16384);
      else if (type === 5) arrayElements = r.readBits(10);
      else {
        lowValue = r.readFloat32();
        highValue = r.readFloat32();
        bitCount = r.readBits(6);
      }
      props.push({
        type,
        name: propName,
        flags,
        priority,
        dataTableName,
        lowValue,
        highValue,
        bitCount,
        arrayElements,
      });
    }
    tables.push({ name, needsDecoder, props });
  }
  const classCount = r.readBits(16);
  if (classCount > 4096) throw new RangeError("server-class limit exceeded");
  const serverClasses: Array<ServerClassSchema> = [];
  for (let i = 0; i < classCount; i++)
    serverClasses.push({
      dataTableId: r.readBits(16),
      className: r.readNullTerminatedString(16384),
      dataTableName: r.readNullTerminatedString(16384),
    });
  return { tables, serverClasses, consumedBits: r.bitOffset };
}

export const SendPropFlag = {
  Unsigned: 1 << 0,
  Coord: 1 << 1,
  NoScale: 1 << 2,
  RoundDown: 1 << 3,
  RoundUp: 1 << 4,
  Normal: 1 << 5,
  Exclude: 1 << 6,
  Xyze: 1 << 7,
  InsideArray: 1 << 8,
  IsVectorElement: 1 << 10,
  Collapsible: 1 << 11,
  CoordMp: 1 << 12,
  CoordMpLowPrecision: 1 << 13,
  CoordMpIntegral: 1 << 14,
  CellCoord: 1 << 15,
  CellCoordLowPrecision: 1 << 16,
  CellCoordIntegral: 1 << 17,
  ChangesOften: 1 << 18,
} as const;

export interface FlattenedSendProp {
  readonly path: string;
  readonly prop: SendPropSchema;
  readonly arrayElement: SendPropSchema | null;
}

export interface FlattenedServerClass extends ServerClassSchema {
  readonly props: readonly FlattenedSendProp[];
}

/** Clean-room implementation of Source 1 send-table exclusion and priority rules. */
export function flattenServerClasses(
  schema: DataTableSchema,
): readonly FlattenedServerClass[] {
  const byName = new Map(schema.tables.map((table) => [table.name, table]));
  return schema.serverClasses.map((serverClass) => {
    const root = byName.get(serverClass.dataTableName);
    if (!root)
      throw new RangeError(`missing send table ${serverClass.dataTableName}`);
    const excludes = new Set<string>();
    const visited = new Set<string>();
    collectExcludes(root, byName, excludes, visited);
    const gathered: FlattenedSendProp[] = [];
    gatherProps(root, "", byName, excludes, gathered, new Set());
    return { ...serverClass, props: sortByPriority(gathered) };
  });
}

function collectExcludes(
  table: SendTableSchema,
  tables: ReadonlyMap<string, SendTableSchema>,
  excludes: Set<string>,
  visited: Set<string>,
): void {
  if (visited.has(table.name)) return;
  visited.add(table.name);
  for (const prop of table.props) {
    if ((prop.flags & SendPropFlag.Exclude) !== 0 && prop.dataTableName)
      excludes.add(`${prop.dataTableName}\0${prop.name}`);
    if (prop.type === 6 && prop.dataTableName) {
      const child = tables.get(prop.dataTableName);
      if (child) collectExcludes(child, tables, excludes, visited);
    }
  }
}

function gatherProps(
  table: SendTableSchema,
  prefix: string,
  tables: ReadonlyMap<string, SendTableSchema>,
  excludes: ReadonlySet<string>,
  output: FlattenedSendProp[],
  stack: Set<string>,
): void {
  if (stack.has(table.name))
    throw new RangeError(`cyclic send table ${table.name}`);
  stack.add(table.name);
  const local: FlattenedSendProp[] = [];
  iterateProps(table, prefix, tables, excludes, output, local, stack);
  output.push(...local);
  stack.delete(table.name);
}

function iterateProps(
  table: SendTableSchema,
  prefix: string,
  tables: ReadonlyMap<string, SendTableSchema>,
  excludes: ReadonlySet<string>,
  output: FlattenedSendProp[],
  local: FlattenedSendProp[],
  stack: Set<string>,
): void {
  for (let index = 0; index < table.props.length; index += 1) {
    const prop = table.props[index]!;
    if (
      (prop.flags & (SendPropFlag.Exclude | SendPropFlag.InsideArray)) !== 0 ||
      excludes.has(`${table.name}\0${prop.name}`)
    )
      continue;
    const path = prefix ? `${prefix}.${prop.name}` : prop.name;
    if (prop.type === 6) {
      if (!prop.dataTableName)
        throw new RangeError(`datatable ${path} has no target`);
      const child = tables.get(prop.dataTableName);
      if (!child)
        throw new RangeError(`missing send table ${prop.dataTableName}`);
      if ((prop.flags & SendPropFlag.Collapsible) !== 0) {
        if (stack.has(child.name))
          throw new RangeError(`cyclic send table ${child.name}`);
        stack.add(child.name);
        iterateProps(child, prefix, tables, excludes, output, local, stack);
        stack.delete(child.name);
      } else {
        gatherProps(
          child,
          prop.name ? prop.name : "",
          tables,
          excludes,
          output,
          stack,
        );
      }
      continue;
    }
    const arrayElement =
      prop.type === 5 && index > 0 ? table.props[index - 1]! : null;
    if (
      prop.type === 5 &&
      arrayElement?.flags !== undefined &&
      (arrayElement.flags & SendPropFlag.InsideArray) === 0
    )
      throw new RangeError(`array ${path} has no inside-array element`);
    local.push({ path, prop, arrayElement });
  }
}

function sortByPriority(
  props: readonly FlattenedSendProp[],
): FlattenedSendProp[] {
  const output = [...props];
  const priorities = [
    ...new Set([...props.map(({ prop }) => prop.priority), 64]),
  ].sort((left, right) => left - right);
  let start = 0;
  for (const priority of priorities) {
    while (true) {
      const index = output.findIndex(({ prop }, candidate) => {
        if (candidate < start) return false;
        return (
          prop.priority === priority ||
          (priority === 64 && (prop.flags & SendPropFlag.ChangesOften) !== 0)
        );
      });
      if (index === -1) break;
      [output[start], output[index]] = [output[index]!, output[start]!];
      start += 1;
    }
  }
  return output;
}
