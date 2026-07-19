import { describe, expect, it } from "vitest";
import { L4D2CenterSource } from "./l4d2center.js";

describe("L4D2CenterSource", () => {
  it("validates and normalizes source entries without trusting list order", async () => {
    const source = new L4D2CenterSource(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            demos: [
              {
                name: "GAMEABC_c1m1_hotel_1700000000.dem.xz",
                date: 1700000100,
                size_mb: 8,
                download:
                  "https://demosdl.l4d2center.com/GAMEABC_c1m1_hotel_1700000000.dem.xz",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(source.discover()).resolves.toEqual([
      expect.objectContaining({
        sourceId: "l4d2center",
        sourceItemKey: "GAMEABC_c1m1_hotel_1700000000.dem.xz",
        gameHint: "GAMEABC",
        declaredBytes: 8 * 1024 * 1024,
        metadata: expect.objectContaining({
          mapKey: "c1m1_hotel",
          chapterHint: 1,
        }),
      }),
    ]);
  });

  it("fails closed on a download host outside the adapter allowlist", async () => {
    const source = new L4D2CenterSource(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            demos: [
              {
                name: "GAMEABC_c1m1_hotel_1700000000.dem.xz",
                date: 1700000100,
                download:
                  "https://evil.example/GAMEABC_c1m1_hotel_1700000000.dem.xz",
              },
            ],
          }),
        ),
    );
    await expect(source.discover()).rejects.toThrow(/invalid entries/);
  });
});
