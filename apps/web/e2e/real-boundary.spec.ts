import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";

const fallbackDemos = [
  "/workspace/data/sprint-4-e2e-corpus/915419_c2m3_coaster/915419_c2m3_coaster.dem",
  "/workspace/data/sprint-4-e2e-corpus/915419_c2m4_barns/915419_c2m4_barns.dem",
];
const freshDemos = [
  "/workspace/tmp/fresh-counter-audit/916532_c8m1_apartment.dem",
  "/workspace/tmp/fresh-counter-audit/916532_c8m2_subway.dem",
  "/workspace/tmp/fresh-counter-audit/916532_c8m3_sewers.dem",
];
const hasFresh = freshDemos.every(existsSync);
const hardRainDemos = [
  "/workspace/tmp/demos/915679_c4m1_milltown_a.dem",
  "/workspace/tmp/demos/915679_c4m2_sugarmill_a.dem",
  "/workspace/tmp/demos/915679_c4m3_sugarmill_b.dem",
  "/workspace/tmp/demos/915679_c4m4_milltown_b.dem",
];
const hasHardRain = hardRainDemos.every(existsSync);
const geometryRoot = [
  process.env.WITCHWATCH_GEOMETRY_ROOT,
  "/tmp/l4d2-geometry-all",
  "/tmp/l4d2-geometry",
].find((candidate) => candidate && existsSync(`${candidate}/catalog.json`));
const hardRainGeometry = hardRainDemos.map(
  (demo) =>
    `${geometryRoot}/${demo.match(/(c\d+m\d+_[a-z0-9_]+)\.dem$/i)?.[1]}.json`,
);
const hasHardRainGeometry =
  geometryRoot !== undefined && hardRainGeometry.every(existsSync);
const demos = hasFresh
  ? freshDemos
  : hasHardRain
    ? hardRainDemos
    : fallbackDemos;

test("uploads and analyzes real demos through the browser, API, worker, and storage", async ({
  page,
}) => {
  test.skip(!demos.every(existsSync), "ignored real corpus is unavailable");
  test.setTimeout(12 * 60_000);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(demos);
  await expect(page.getByRole("button", { name: "players" })).toBeVisible({
    timeout: 10 * 60_000,
  });
  const parserProvenance = page.getByRole("button", {
    name: /Parser provenance:/,
  });
  await parserProvenance.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    /Rust native \d+\.\d+\.\d+ · build [a-f0-9]{8}/,
  );
  const parserAttestations = await page.evaluate(async () => {
    const match = window.location.pathname.match(/^\/game\/([^/]+)/);
    if (!match) throw new Error("real boundary did not resolve to a game URL");
    const response = await fetch(
      `/api/games/${encodeURIComponent(decodeURIComponent(match[1]!))}`,
    );
    if (!response.ok)
      throw new Error(`game lineage request failed: ${response.status}`);
    const game = (await response.json()) as {
      analyses: Array<{
        engineResult: {
          demo: { parser?: Record<string, unknown> };
          cases: Array<{ versions?: { parser?: string } }>;
        };
      }>;
    };
    return game.analyses.map(({ engineResult }) => ({
      parser: engineResult.demo.parser,
      caseParsers: engineResult.cases.map((item) => item.versions?.parser),
    }));
  });
  expect(parserAttestations).toHaveLength(demos.length);
  for (const { parser, caseParsers } of parserAttestations) {
    expect(parser).toMatchObject({
      engine: "rust-native",
      bindingApiVersion: 2,
      configVersion: 1,
      wireVersion: 1,
      parserConfigId: "source1-l4d2-2100-v1",
    });
    expect(parser?.buildSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parser?.buildSha256).not.toMatch(/^0{64}$/);
    const prefix = `demo-source1-native@${String(parser?.coreVersion)}+node-${String(parser?.bindingVersion)}/config-1/build-${String(parser?.buildSha256)}`;
    expect(caseParsers.every((value) => value === prefix)).toBe(true);
  }
  if (hasFresh) {
    await expect(
      page.getByRole("heading", { level: 1, name: "No Mercy" }),
    ).toBeVisible();
    for (const map of ["c8m1_apartment", "c8m2_subway", "c8m3_sewers"])
      await expect(
        page.getByRole("link", { name: `Open analysis for ${map}` }),
      ).toBeVisible();
  } else if (hasHardRain) {
    await expect(
      page.getByRole("heading", { level: 1, name: "Hard Rain" }),
    ).toBeVisible();
    await expect(page.getByText("525 : 122", { exact: true })).toBeVisible();
    await expect(page.getByText("1,237 : 461", { exact: true })).toBeVisible();
    await expect(page.getByText("1,485 : 698", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByText("c2m3_coaster", { exact: true })).toBeVisible();
    await expect(page.getByText("c2m4_barns", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "players" }).click();
  await expect(
    page.locator(".consolidated-player-table tbody tr").first(),
  ).toBeVisible();
  if (hasFresh) {
    await expect(
      page.locator(".consolidated-player-table tbody tr"),
    ).toHaveCount(8);
    await expect(
      page.locator(
        '.consolidated-player-table a[href^="https://steamcommunity.com/profiles/"]',
      ),
    ).toHaveCount(8);
    await expect(page.getByText(/^Player [A-F0-9]{6}$/)).toHaveCount(0);
    await page.getByRole("button", { name: "combat" }).click();
    await expect(page.getByText("reanalyze for HP")).toHaveCount(0);
    const healthDrawdowns = await page
      .locator(".hp-loss-pill")
      .allTextContents();
    expect(healthDrawdowns.length).toBeGreaterThan(0);
    expect(
      healthDrawdowns.every((label) => {
        const value = Number(label.replace(/[^0-9]/g, ""));
        return Number.isFinite(value) && value <= 400;
      }),
    ).toBe(true);
  } else if (hasHardRain) {
    await expect(
      page.locator(".consolidated-player-table tbody tr"),
    ).toHaveCount(8);
    await expect(
      page.locator(
        '.consolidated-player-table a[href^="https://steamcommunity.com/profiles/"]',
      ),
    ).toHaveCount(8);
    for (const player of [
      "BINGO #HDP",
      "demigod",
      "Yurasos",
      "KICK/RIKACHUI",
      "399",
      "unbeatable",
      "Путь к 15 000 MMR",
      "Ｒｙｏ",
    ])
      await expect(
        page.locator(".consolidated-player-table").getByText(player, {
          exact: true,
        }),
      ).toBeVisible();
    await expect(page.getByText(/^Player [A-F0-9]{6}$/)).toHaveCount(0);

    await page.getByRole("button", { name: "combat" }).click();
    if (hasHardRainGeometry) {
      const geometryMaps = page.locator(".geometry-map");
      const spatialWorkspace = page.locator(".spatial-workspace");
      await expect(geometryMaps).toHaveCount(1);
      await expect(
        geometryMaps.getByText(/Spatial combat · actual BSP geometry/),
      ).toHaveCount(1);
      await expect(geometryMaps.locator("canvas")).toHaveCount(1);

      const pixelProof: Array<{
        map: string;
        width: number;
        height: number;
        changedPixels: number;
        markerPixels: number;
      }> = [];
      for (const map of [
        "c4m1_milltown_a",
        "c4m2_sugarmill_a",
        "c4m3_sugarmill_b",
        "c4m4_milltown_b",
      ]) {
        await page
          .getByRole("button", { name: `Show spatial combat for ${map}` })
          .click();
        await expect(geometryMaps).toHaveCount(1);
        await expect(geometryMaps.locator("h3")).toContainText(map);
        await expect(
          geometryMaps.getByText(/world-brush triangles · BSP/),
        ).toHaveCount(1);
        const canvas = await geometryMaps.locator("canvas").evaluate((node) => {
          const element = node as HTMLCanvasElement;
          const context = element.getContext("2d");
          if (!context)
            return {
              width: 0,
              height: 0,
              changedPixels: 0,
              markerPixels: 0,
            };
          const { data } = context.getImageData(
            0,
            0,
            element.width,
            element.height,
          );
          let changedPixels = 0;
          let markerPixels = 0;
          const markerPalette = [
            [167, 255, 56],
            [74, 199, 255],
            [213, 140, 255],
            [255, 193, 92],
            [255, 102, 91],
          ];
          for (let offset = 0; offset < data.length; offset += 4) {
            if (
              data[offset] !== 8 ||
              data[offset + 1] !== 13 ||
              data[offset + 2] !== 10
            )
              changedPixels += 1;
            if (
              markerPalette.some(
                ([red, green, blue]) =>
                  Math.abs((data[offset] ?? 0) - red!) <= 2 &&
                  Math.abs((data[offset + 1] ?? 0) - green!) <= 2 &&
                  Math.abs((data[offset + 2] ?? 0) - blue!) <= 2,
              )
            )
              markerPixels += 1;
          }
          return {
            width: element.width,
            height: element.height,
            changedPixels,
            markerPixels,
          };
        });
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.height).toBeGreaterThan(0);
        expect(canvas.changedPixels).toBeGreaterThan(1_000);
        expect(canvas.markerPixels).toBeGreaterThan(20);
        pixelProof.push({ map, ...canvas });
        await test.info().attach(`${map}-canvas-pixel-proof`, {
          body: Buffer.from(JSON.stringify({ map, ...canvas }, null, 2)),
          contentType: "application/json",
        });
      }
      test.info().annotations.push({
        type: "geometry-pixel-proof",
        description: JSON.stringify(pixelProof),
      });
      await test.info().attach("hard-rain-spatial-combat", {
        body: await spatialWorkspace.screenshot(),
        contentType: "image/png",
      });
    }
  }
  await page.getByRole("button", { name: "data coverage" }).click();
  await expect(page.getByText("Reproducible inputs")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of [
    "overview",
    "players",
    "combat",
    "timeline",
    "signals",
    "data coverage",
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    const documentWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(documentWidth, `${tab} document width at 390px`).toBeLessThanOrEqual(
      391,
    );
  }
  const undersizedText = await page
    .locator(".results-screen *")
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            (element as HTMLElement).offsetParent !== null &&
            [...element.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            ) &&
            Number.parseFloat(getComputedStyle(element).fontSize) < 11,
        )
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 60),
          size: getComputedStyle(element).fontSize,
        })),
    );
  expect(undersizedText).toEqual([]);
  await test.info().attach("fresh-analysis-mobile", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
