import { createHmac } from "node:crypto";
import {
  decodeDemo,
  decodeL4d2UserInfo,
  decodeNetworkStringTableChanges,
  decodeStringTableSnapshot,
  extractNetworkBits,
  inspectNetworkPayload,
  unwrapL4d2StringTableData,
  type DemoStringTable,
} from "@witchwatch/demo-source1";
import type { ProjectableUserInfo } from "./entity-projection.js";

export interface UserInfoPrivacyOptions {
  /** Secret deployment/review key. It is never included in returned data. */
  readonly pseudonymKey: Uint8Array | string;
}

export interface UserInfoProjectionResult {
  readonly mappings: readonly ProjectableUserInfo[];
  /** Display identity is kept separate from the privacy-safe join mapping. */
  readonly displayIdentities: readonly DisplayUserInfoIdentity[];
  readonly rejectedEntries: number;
}

export interface DisplayUserInfoIdentity {
  readonly entityIndex: number;
  readonly userInfoSlot: number;
  readonly userId: number;
  readonly effectiveTick?: number;
  readonly displayName: string;
  readonly fakePlayer: boolean;
  /** Decimal SteamID64 suitable for a steamcommunity.com/profiles URL. */
  readonly steamId64?: string;
}

/** Collects privacy-safe, tick-timed initial and dynamic userinfo mappings. */
export function collectL4d2UserInfoTimeline(
  bytes: Uint8Array,
  options: UserInfoPrivacyOptions,
): UserInfoProjectionResult {
  const demo = decodeDemo(bytes);
  const key = keyBytes(options.pseudonymKey);
  const mappings: ProjectableUserInfo[] = [];
  const displayIdentities: DisplayUserInfoIdentity[] = [];
  let snapshotMappings: readonly ProjectableUserInfo[] = [];
  let snapshotDisplayIdentities: readonly DisplayUserInfoIdentity[] = [];
  const touchedSlots = new Set<number>();
  let rejectedEntries = 0;
  const schemas: Array<{
    name: string;
    maxEntries: number;
    userDataFixedSize: boolean;
    userDataSizeBits: number | null;
    existingNames: Map<number, string>;
  }> = [];
  const snapshotFrame = demo.frames.find(
    ({ kind }) => kind === "string-tables",
  );
  if (snapshotFrame?.payload) {
    const initial = projectUserInfoIdentities(
      decodeStringTableSnapshot(snapshotFrame.payload).tables.find(
        ({ name }) => name === "userinfo",
      ),
      options,
    );
    snapshotMappings = initial.mappings;
    snapshotDisplayIdentities = initial.displayIdentities;
    rejectedEntries += initial.rejectedEntries;
  }
  for (const frame of demo.frames) {
    if (!frame.payload || (frame.kind !== "packet" && frame.kind !== "signon"))
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
        if (schema.name !== "userinfo") continue;
        const raw = extractNetworkBits(
          frame.payload,
          value.dataStartBit,
          value.dataBitLength,
        );
        const nested = unwrapL4d2StringTableData(raw, value.dataCompressed);
        applyTimedChanges(
          decodeNetworkStringTableChanges(
            nested,
            value.dataCompressed ? nested.byteLength * 8 : value.dataBitLength,
            value.entryCount,
            schema,
          ),
          schema,
          frame.tick ?? 0,
          key,
          mappings,
          displayIdentities,
          () => rejectedEntries++,
          false,
          false,
          touchedSlots,
        );
      } else if (envelope?.kind === "update-string-table") {
        const value = envelope.value,
          schema = schemas[value.tableId];
        if (!schema || schema.name !== "userinfo") continue;
        applyTimedChanges(
          decodeNetworkStringTableChanges(
            extractNetworkBits(
              frame.payload,
              value.dataStartBit,
              value.dataBitLength,
            ),
            value.dataBitLength,
            value.changedEntries,
            schema,
          ),
          schema,
          frame.tick ?? 0,
          key,
          mappings,
          displayIdentities,
          () => rejectedEntries++,
          true,
          true,
          touchedSlots,
        );
      }
    }
  }
  const reconciled = reconcileUserInfoTimeline(
    snapshotMappings,
    mappings,
    touchedSlots,
  );
  const deduplicated = new Map<string, ProjectableUserInfo>();
  for (const mapping of reconciled)
    deduplicated.set(
      `${mapping.entityIndex}:${mapping.effectiveTick ?? "initial"}`,
      mapping,
    );
  const reconciledDisplay = [
    ...snapshotDisplayIdentities
      .filter(({ userInfoSlot }) => !touchedSlots.has(userInfoSlot))
      .map((identity) => ({ ...identity, effectiveTick: 0 })),
    ...displayIdentities,
  ];
  const displayDeduplicated = new Map<string, DisplayUserInfoIdentity>();
  for (const identity of reconciledDisplay)
    displayDeduplicated.set(
      `${identity.entityIndex}:${identity.effectiveTick ?? "initial"}`,
      identity,
    );
  return {
    mappings: [...deduplicated.values()],
    displayIdentities: [...displayDeduplicated.values()],
    rejectedEntries,
  };
}

/** Applies the no-time-travel policy used for final demo snapshots. */
export function reconcileUserInfoTimeline(
  snapshot: readonly ProjectableUserInfo[],
  dynamic: readonly ProjectableUserInfo[],
  touchedSlots: ReadonlySet<number>,
): readonly ProjectableUserInfo[] {
  return [
    ...snapshot
      .filter(({ userInfoSlot }) => !touchedSlots.has(userInfoSlot))
      .map((mapping) => ({ ...mapping, effectiveTick: 0 })),
    ...dynamic,
  ];
}

function applyTimedChanges(
  changes: readonly import("@witchwatch/demo-source1").NetworkStringTableChange[],
  schema: { existingNames: Map<number, string> },
  tick: number,
  key: Uint8Array,
  output: ProjectableUserInfo[],
  displayOutput: DisplayUserInfoIdentity[],
  reject: () => void,
  clearMissingData: boolean,
  emit: boolean,
  touchedSlots: Set<number>,
): void {
  for (const change of changes) {
    if (change.name !== undefined)
      schema.existingNames.set(change.entryIndex, change.name);
    if (emit) touchedSlots.add(change.entryIndex);
    if (!change.data) {
      if (emit && clearMissingData)
        output.push({
          entityIndex: change.entryIndex + 1,
          userInfoSlot: change.entryIndex,
          effectiveTick: tick,
        });
      continue;
    }
    if (!emit) continue;
    try {
      const identity = decodeL4d2UserInfo(change.data);
      output.push({
        entityIndex: change.entryIndex + 1,
        userInfoSlot: change.entryIndex,
        userId: identity.userId,
        effectiveTick: tick,
        ...(!identity.fakePlayer && identity.steamId64 !== 0n
          ? { stableIdentityToken: token(identity.steamId64, key) }
          : {}),
      });
      displayOutput.push({
        entityIndex: change.entryIndex + 1,
        userInfoSlot: change.entryIndex,
        userId: identity.userId,
        effectiveTick: tick,
        displayName: identity.displayName,
        fakePlayer: identity.fakePlayer,
        ...(!identity.fakePlayer && identity.steamId64 !== 0n
          ? { steamId64: identity.steamId64.toString(10) }
          : {}),
      });
    } catch {
      reject();
    }
  }
}

/**
 * Converts the protocol-2100 `userinfo` snapshot to projection mappings.
 *
 * Source uses zero-based userinfo slots and one-based player edicts. Raw
 * names, GUID text and Steam IDs never leave this function. Human identities
 * are keyed before hashing, preventing useful cross-installation correlation.
 * Invalid/truncated entries fail closed and are counted, never partially used.
 */
export function projectUserInfoIdentities(
  table: DemoStringTable | undefined,
  options: UserInfoPrivacyOptions,
): UserInfoProjectionResult {
  if (!table || table.name !== "userinfo")
    return { mappings: [], displayIdentities: [], rejectedEntries: 0 };
  const key = keyBytes(options.pseudonymKey);
  const mappings: ProjectableUserInfo[] = [];
  const displayIdentities: DisplayUserInfoIdentity[] = [];
  let rejectedEntries = 0;
  for (let slot = 0; slot < table.entries.length; slot += 1) {
    const data = table.entries[slot]?.data;
    if (!data) continue;
    try {
      const identity = decodeL4d2UserInfo(data);
      const stableIdentityToken =
        !identity.fakePlayer && identity.steamId64 !== 0n
          ? token(identity.steamId64, key)
          : undefined;
      mappings.push({
        entityIndex: slot + 1,
        userInfoSlot: slot,
        userId: identity.userId,
        ...(stableIdentityToken === undefined ? {} : { stableIdentityToken }),
      });
      displayIdentities.push({
        entityIndex: slot + 1,
        userInfoSlot: slot,
        userId: identity.userId,
        displayName: identity.displayName,
        fakePlayer: identity.fakePlayer,
        ...(!identity.fakePlayer && identity.steamId64 !== 0n
          ? { steamId64: identity.steamId64.toString(10) }
          : {}),
      });
    } catch {
      rejectedEntries += 1;
    }
  }
  return { mappings, displayIdentities, rejectedEntries };
}

const token = (steamId: bigint, key: Uint8Array): string =>
  `hmac-sha256:${createHmac("sha256", key).update(steamId.toString(10), "utf8").digest("hex")}`;

function keyBytes(value: Uint8Array | string): Uint8Array {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (bytes.byteLength < 16)
    throw new RangeError("pseudonymKey must contain at least 16 bytes");
  return bytes;
}
