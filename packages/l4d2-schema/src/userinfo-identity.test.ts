import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  decodeDemo,
  decodeStringTableSnapshot,
} from "@witchwatch/demo-source1";
import {
  collectL4d2UserInfoTimeline,
  projectUserInfoIdentities,
  reconcileUserInfoTimeline,
} from "./userinfo-identity";

const entry = (steamId: bigint, userId: number, fake = false) => {
  const data = new Uint8Array(140);
  const view = new DataView(data.buffer);
  view.setBigUint64(0, steamId, true);
  view.setInt32(40, userId, true);
  data[116] = fake ? 1 : 0;
  return { name: "raw name must be ignored", data };
};

describe("projectUserInfoIdentities", () => {
  it("backfills only snapshot slots untouched by timed updates", () => {
    const snapshot = [
      {
        entityIndex: 1,
        userInfoSlot: 0,
        userId: 1,
        stableIdentityToken: "constant",
      },
      {
        entityIndex: 2,
        userInfoSlot: 1,
        userId: 2,
        stableIdentityToken: "final-only",
      },
    ];
    const dynamic = [
      {
        entityIndex: 2,
        userInfoSlot: 1,
        userId: 3,
        stableIdentityToken: "timed",
        effectiveTick: 200,
      },
    ];
    expect(reconcileUserInfoTimeline(snapshot, dynamic, new Set([1]))).toEqual([
      { ...snapshot[0], effectiveTick: 0 },
      dynamic[0],
    ]);
  });
  it("binds slot to player edict and emits deterministic keyed pseudonyms", () => {
    const table = {
      name: "userinfo",
      entries: [entry(76561198000000001n, 7)],
      clientEntries: [],
    };
    const first = projectUserInfoIdentities(table, {
      pseudonymKey: "0123456789abcdef",
    });
    const second = projectUserInfoIdentities(table, {
      pseudonymKey: "0123456789abcdef",
    });
    expect(first).toEqual(second);
    expect(first.mappings[0]).toMatchObject({
      entityIndex: 1,
      userInfoSlot: 0,
      userId: 7,
    });
    expect(first.mappings[0]!.stableIdentityToken).toMatch(
      /^hmac-sha256:[a-f\d]{64}$/,
    );
    expect(JSON.stringify(first)).not.toContain("76561198000000001");
    expect(JSON.stringify(first)).not.toContain("raw name");
    expect(
      projectUserInfoIdentities(table, { pseudonymKey: "fedcba9876543210" }),
    ).not.toEqual(first);
  });

  it("fails closed for bots, missing tables, corrupt records, and weak keys", () => {
    const table = {
      name: "userinfo",
      entries: [entry(0n, 2, true), { name: "bad", data: new Uint8Array(2) }],
      clientEntries: [],
    };
    const result = projectUserInfoIdentities(table, {
      pseudonymKey: new Uint8Array(16),
    });
    expect(result).toEqual({
      mappings: [{ entityIndex: 1, userInfoSlot: 0, userId: 2 }],
      rejectedEntries: 1,
    });
    expect(
      projectUserInfoIdentities(undefined, {
        pseudonymKey: new Uint8Array(16),
      }),
    ).toEqual({ mappings: [], rejectedEntries: 0 });
    expect(() =>
      projectUserInfoIdentities(table, { pseudonymKey: "short" }),
    ).toThrow(/16 bytes/);
  });
});

const corpusRoot = join(process.cwd(), "../../data/sprint-1-corpus/extracted");
it.runIf(existsSync(corpusRoot))(
  "projects every real-corpus initial userinfo snapshot without exposing identifiers",
  () => {
    const demos = readdirSync(corpusRoot, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".dem"))
      .map((entry) => join(entry.parentPath, entry.name));
    expect(demos.length).toBeGreaterThanOrEqual(10);
    const dynamicCounts: number[] = [];
    let explicitClears = 0;
    for (const path of demos) {
      const bytes = readFileSync(path);
      const frame = decodeDemo(bytes).frames.find(
        ({ kind }) => kind === "string-tables",
      );
      const table = frame?.payload
        ? decodeStringTableSnapshot(frame.payload).tables.find(
            ({ name }) => name === "userinfo",
          )
        : undefined;
      const result = projectUserInfoIdentities(table, {
        pseudonymKey: "corpus-test-key-only",
      });
      expect(result.mappings.length).toBeGreaterThan(0);
      expect(
        result.mappings.some(
          ({ stableIdentityToken }) => stableIdentityToken !== undefined,
        ),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/7656119\d{10}/);
      const timeline = collectL4d2UserInfoTimeline(bytes, {
        pseudonymKey: "corpus-test-key-only",
      });
      expect(
        timeline.mappings.some(
          ({ effectiveTick }) => effectiveTick !== undefined,
        ),
      ).toBe(true);
      expect(JSON.stringify(timeline)).not.toMatch(/7656119\d{10}/);
      dynamicCounts.push(
        timeline.mappings.filter(
          ({ effectiveTick }) => (effectiveTick ?? 0) !== (frame?.tick ?? 0),
        ).length,
      );
      explicitClears += timeline.mappings.filter(
        ({ effectiveTick, userId, stableIdentityToken }) =>
          effectiveTick !== undefined &&
          userId === undefined &&
          stableIdentityToken === undefined,
      ).length;
    }
    expect(explicitClears).toBeGreaterThan(0);
    console.info("Redacted timed userinfo update counts", dynamicCounts);
  },
  30_000,
);
