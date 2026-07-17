import { describe, expect, it } from "vitest";
import {
  decodeL4d2DataTables,
  flattenServerClasses,
  SendPropFlag,
  type DataTableSchema,
  type SendPropSchema,
} from "./data-tables";

const scalar = (name: string): SendPropSchema => ({
  type: 0,
  name,
  flags: SendPropFlag.Unsigned,
  priority: 0,
  dataTableName: null,
  lowValue: 0,
  highValue: 1,
  bitCount: 1,
  arrayElements: null,
});

const dataTable = (
  name: string,
  target: string,
  collapsible: boolean,
): SendPropSchema => ({
  type: 6,
  name,
  flags: collapsible ? SendPropFlag.Collapsible : 0,
  priority: 0,
  dataTableName: target,
  lowValue: null,
  highValue: null,
  bitCount: null,
  arrayElements: null,
});

describe("L4D2 data tables", () => {
  it("fails closed on truncated schemas", () =>
    expect(() => decodeL4d2DataTables(Uint8Array.of(1))).toThrow());
  it("accepts an empty bounded schema", () =>
    expect(decodeL4d2DataTables(Uint8Array.of(0, 0, 0))).toMatchObject({
      tables: [],
      serverClasses: [],
    }));

  it("orders nested non-collapsible descendants before local properties", () => {
    const schema: DataTableSchema = {
      consumedBits: 0,
      serverClasses: [
        { dataTableId: 0, className: "CTest", dataTableName: "DT_Root" },
      ],
      tables: [
        {
          name: "DT_Root",
          needsDecoder: true,
          props: [dataTable("collapsed", "DT_Child", true), scalar("root")],
        },
        {
          name: "DT_Child",
          needsDecoder: true,
          props: [scalar("child"), dataTable("branch", "DT_Leaf", false)],
        },
        {
          name: "DT_Leaf",
          needsDecoder: true,
          props: [scalar("leaf")],
        },
      ],
    };
    expect(
      flattenServerClasses(schema)[0]!.props.map(({ path }) => path),
    ).toEqual(["branch.leaf", "child", "root"]);
  });
});
