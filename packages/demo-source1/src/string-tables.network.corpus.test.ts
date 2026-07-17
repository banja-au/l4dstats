import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeDemo } from "./decode";
import { extractNetworkBits, inspectNetworkPayload } from "./network";
import {
  decodeL4d2UserInfo,
  decodeNetworkStringTableChanges,
  unwrapL4d2StringTableData,
} from "./string-tables";

const root = join(process.cwd(), "../../data/sprint-1-corpus/extracted");

describe.runIf(existsSync(root))("network string-table corpus", () => {
  it("decodes all userinfo create/update streams fail-closed", () => {
    const paths = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".dem"))
      .map((entry) => join(entry.parentPath, entry.name));
    let userInfoRecords = 0;
    for (const path of paths) {
      const schemas: Array<{
        name: string;
        maxEntries: number;
        userDataFixedSize: boolean;
        userDataSizeBits: number | null;
        existingNames: Map<number, string>;
      }> = [];
      for (const frame of decodeDemo(readFileSync(path)).frames) {
        if (
          !frame.payload ||
          (frame.kind !== "packet" && frame.kind !== "signon")
        )
          continue;
        for (const message of inspectNetworkPayload(frame.payload).messages) {
          const envelope = message.envelope;
          if (envelope?.kind === "create-string-table") {
            const value = envelope.value;
            const schema = {
              name: value.tableName,
              maxEntries: value.maxEntries,
              userDataFixedSize: value.userDataFixedSize,
              userDataSizeBits: value.userDataSizeBits,
              existingNames: new Map<number, string>(),
            };
            schemas.push(schema);
            if (value.tableName === "userinfo") {
              const nested = unwrapL4d2StringTableData(
                extractNetworkBits(
                  frame.payload,
                  value.dataStartBit,
                  value.dataBitLength,
                ),
                value.dataCompressed,
              );
              const changes = decodeNetworkStringTableChanges(
                nested,
                value.dataCompressed
                  ? nested.byteLength * 8
                  : value.dataBitLength,
                value.entryCount,
                schema,
              );
              for (const change of changes)
                if (change.name !== undefined)
                  schema.existingNames.set(change.entryIndex, change.name);
              for (const change of changes)
                if (change.data) {
                  decodeL4d2UserInfo(change.data);
                  userInfoRecords += 1;
                }
            }
          } else if (envelope?.kind === "update-string-table") {
            const value = envelope.value;
            const schema = schemas[value.tableId];
            expect(schema).toBeDefined();
            if (schema!.name === "userinfo") {
              const changes = decodeNetworkStringTableChanges(
                extractNetworkBits(
                  frame.payload,
                  value.dataStartBit,
                  value.dataBitLength,
                ),
                value.dataBitLength,
                value.changedEntries,
                schema!,
              );
              for (const change of changes)
                if (change.name !== undefined)
                  schema!.existingNames.set(change.entryIndex, change.name);
              for (const change of changes)
                if (change.data) {
                  decodeL4d2UserInfo(change.data);
                  userInfoRecords += 1;
                }
            }
          }
        }
      }
    }
    expect(userInfoRecords).toBeGreaterThan(0);
  }, 60_000);
});
