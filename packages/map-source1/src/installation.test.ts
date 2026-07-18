import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCompleteOfficialCampaignInstallation,
  discoverInstalledCampaignBsps,
  isOfficialCampaignBsp,
} from "./installation.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixtureFile(
  root: string,
  contentRoot: string,
  filename: string,
) {
  const directory = join(root, contentRoot, "maps");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), contentRoot);
}

describe("installed L4D2 campaign BSP discovery", () => {
  it.each([
    ["c1m1_hotel.bsp", true],
    ["c14m2_lighthouse.bsp", true],
    ["c5m1_waterfront_sndscape.bsp", false],
    ["curling_stadium.bsp", false],
    ["c15m1_custom.bsp", false],
    ["c4m6_out_of_range.bsp", false],
  ])("classifies %s", (filename, expected) =>
    expect(isOfficialCampaignBsp(filename)).toBe(expected),
  );

  it("merges content roots with Source override precedence", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-map-install-"));
    temporaryRoots.push(root);
    await fixtureFile(root, "left4dead2", "c1m1_hotel.bsp");
    await fixtureFile(root, "left4dead2", "c6m1_riverbank.bsp");
    await fixtureFile(root, "left4dead2_dlc1", "c6m1_riverbank.bsp");
    await fixtureFile(root, "update", "c6m1_riverbank.bsp");
    await fixtureFile(root, "left4dead2", "c5m1_waterfront_sndscape.bsp");
    await fixtureFile(root, "left4dead2", "curling_stadium.bsp");

    expect(await discoverInstalledCampaignBsps(root)).toEqual([
      {
        map: "c1m1_hotel",
        path: join(root, "left4dead2", "maps", "c1m1_hotel.bsp"),
        contentRoot: "left4dead2",
      },
      {
        map: "c6m1_riverbank",
        path: join(root, "update", "maps", "c6m1_riverbank.bsp"),
        contentRoot: "update",
      },
    ]);
  });

  it("reports every missing official chapter in a partial installation", () => {
    expect(() =>
      assertCompleteOfficialCampaignInstallation([
        {
          map: "c1m1_hotel",
          path: "/maps/c1m1_hotel.bsp",
          contentRoot: "left4dead2",
        },
      ]),
    ).toThrow("missing c1m2");
  });
});
