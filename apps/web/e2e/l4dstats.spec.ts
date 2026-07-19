import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const halfSummary = (infectedClasses: string[] = []) => ({
  sampleCount: 100,
  durationSeconds: 360,
  distanceUnits: 1000,
  viewTravelDegrees: 500,
  observedPositionRate: 0.98,
  observedAnglesRate: 0.91,
  observedTeamRate: 1,
  observedClassRate: 0.9,
  observedWeaponRate: 0.8,
  weapons: ["weapon_rifle"],
  survivorDeaths: 0,
  infectedDeaths: 0,
  specialInfectedKills: 1,
  headshotKills: 0,
  pinSeconds: 0,
  ghostSeconds: 0,
  observedHealthLost: 10,
  killsByWeapon: { rifle_ak47: 1 },
  killsByInfectedClass: { Hunter: 1 },
  infectedClasses,
});

const stats = {
  durationSeconds: 742,
  playbackTicks: 22260,
  tickRate: 30,
  playerCount: 4,
  observationCount: 18420,
  eventCount: 1337,
  requiredEvents: { player_hurt: 420, weapon_fire: 312, infected_hurt: 605 },
  decodeIssueCount: 0,
  availability: {
    position: 0.98,
    eyeAngles: 0.91,
    team: 1,
    playerClass: 0.87,
    weapon: 0.76,
  },
  match: {
    roundStarts: 1,
    roundEnds: 2,
    survivorDeaths: 3,
    specialInfectedDeaths: 31,
    tankDeaths: 1,
    witchDeaths: 1,
    specialKillsByClass: { Hunter: 12, Smoker: 9, Charger: 6, Tank: 1 },
    killsByWeapon: { rifle_ak47: 18, shotgun_spas: 8 },
    campaignScores: [636, 482],
    chapterScores: [90, 0],
    survivorScores: [90, 0],
    survivorDistances: [100, 90, 80, 70],
    survivorDeathDistances: [],
    roundDurations: [350, 370],
    roundNumber: 2,
    teamsFlipped: true,
    secondHalf: true,
    scoreTimeline: [
      {
        tick: 0,
        timeSeconds: 0,
        campaignScores: [636, 482],
        chapterScores: [0, 0],
        survivorScores: [0, 0],
        survivorDistances: [],
        teamsFlipped: false,
        secondHalf: false,
      },
      {
        tick: 11000,
        timeSeconds: 366,
        campaignScores: [636, 482],
        chapterScores: [90, 0],
        survivorScores: [90, 0],
        survivorDistances: [100, 90, 80, 70],
        teamsFlipped: true,
        secondHalf: true,
      },
    ],
  },
  timeline: [
    {
      tick: 9000,
      timeSeconds: 300,
      type: "pin_start",
      actor: "Player 10BDEE",
      victim: "Player 9A72F0",
      infectedClass: "Hunter",
      detail: "Player 10BDEE started a Hunter pounce on Player 9A72F0",
    },
    {
      tick: 9030,
      timeSeconds: 301,
      type: "death",
      actor: "Player 9A72F0",
      victim: "Player 10BDEE",
      infectedClass: "Hunter",
      weapon: "rifle_ak47",
      detail: "Player 9A72F0 killed Hunter with rifle_ak47",
      position: { x: 120, y: 40, z: 10 },
    },
    {
      tick: 9030,
      timeSeconds: 301,
      type: "clear",
      actor: "Player 9A72F0",
      victim: "Player 9A72F0",
      infectedClass: "Hunter",
      detail: "Player 9A72F0 cleared Player 9A72F0 from a Hunter pounce",
    },
    {
      tick: 9200,
      timeSeconds: 306.667,
      type: "tank_control",
      actor: "Player 10BDEE",
      actorPlayerId: "p2",
      infectedClass: "Tank",
      detail: "Player 10BDEE took control of the Tank",
    },
    {
      tick: 9400,
      timeSeconds: 313,
      type: "witch_spawn",
      infectedClass: "Witch",
      detail: "Witch entity became observable",
    },
    {
      tick: 9700,
      timeSeconds: 323,
      type: "witch_enrage",
      infectedClass: "Witch",
      detail: "Witch network rage reached the enraged threshold",
    },
    {
      tick: 9800,
      timeSeconds: 326,
      type: "witch_end",
      infectedClass: "Witch",
      detail: "Witch entity ended near a Witch death event",
    },
    {
      tick: 9900,
      timeSeconds: 330,
      type: "round_end",
      detail: "Round ended after the Survivor team was stopped",
    },
  ],
  competitive: {
    derivationVersion: 6,
    rosters: [
      {
        id: "A",
        playerIds: ["p1"],
        confidence: "provisional",
        inference: "side-swap-v1",
        sides: [{ halfId: "first", side: "Survivor" }],
      },
      {
        id: "B",
        playerIds: ["p2"],
        confidence: "provisional",
        inference: "side-swap-v1",
        sides: [{ halfId: "first", side: "Infected" }],
      },
    ],
    halves: [
      {
        id: "first",
        secondHalf: false,
        tickRange: { start: 0, end: 11000 },
        survivorPlayerIds: ["p1", "p3"],
        infectedPlayerIds: ["p2"],
        observedOpeningArea: {
          availability: "derived",
          derivation: "survivor-opening-area-v1",
          anchor: { kind: "round-start", tick: 20 },
          tickRange: { start: 22, end: 24 },
          samples: [
            { playerId: "p1", tick: 22, position: { x: 80, y: 80, z: 10 } },
            { playerId: "p3", tick: 24, position: { x: 120, y: 100, z: 10 } },
          ],
          center: { x: 100, y: 90, z: 10 },
          bounds: {
            min: { x: 80, y: 80, z: 10 },
            max: { x: 120, y: 100, z: 10 },
          },
          planarRadiusUnits: 22.36,
          limitations: [
            "demo-derived-not-map-authored",
            "first-observed-position-per-player",
          ],
        },
        players: [
          {
            playerId: "p1",
            side: "Survivor",
            counterDeltas: { m_checkpointDamageToTank: 610 },
            observedCounters: ["m_checkpointDamageToTank"],
            summary: halfSummary(),
          },
          {
            playerId: "p2",
            side: "Infected",
            counterDeltas: { m_checkpointPZHunterDamage: 20 },
            observedCounters: ["m_checkpointPZHunterDamage"],
            summary: halfSummary(["Hunter"]),
          },
        ],
      },
    ],
    infectedLives: [
      {
        id: "life1",
        playerId: "p2",
        playerAlias: "Player 10BDEE",
        infectedClass: "Hunter",
        tickRange: { start: 8900, end: 9030 },
        durationSeconds: 4.3,
        startReason: "spawn",
        endReason: "death",
        controls: 1,
        pinSeconds: 1,
        counterDeltas: {},
      },
    ],
    hits: [
      {
        id: "hit1",
        tickRange: { start: 8900, end: 9000 },
        lifeIds: ["life1"],
        playerIds: ["p2"],
        infectedClasses: ["Hunter", "Smoker"],
        spawnSpreadSeconds: 1.2,
        controls: 1,
        peakSimultaneousPins: 1,
        observedSurvivorHealthLoss: 18,
        survivorHealthSamples: 12,
        inference: "spawn-gap-v1",
      },
    ],
    clearStats: [
      {
        playerId: "p1",
        playerAlias: "Player 9A72F0",
        deathCorrelatedClears: 1,
        responseSeconds: [1],
        medianResponseSeconds: 1,
      },
    ],
    tankEncounters: [
      {
        id: "tank1",
        controllerId: "p2",
        controllerAlias: "Player 10BDEE",
        tickRange: { start: 10000, end: 11000 },
        durationSeconds: 33,
        healthAtTake: 6000,
        lowestObservedHealth: 0,
        healthAtEnd: 0,
        maximumObservedFrustration: 20,
        punches: 2,
        registeredRockThrows: 1,
        survivorIncaps: 1,
        survivorDeaths: 0,
        endReason: "death",
      },
    ],
  },
  witchEncounters: [
    {
      id: "witch-31:4",
      entityIndex: 31,
      tickRange: { start: 9400, end: 9800 },
      timeRange: { start: 313, end: 326 },
      enragedTick: 9700,
      burningTick: null,
      peakRage: 1,
      peakWanderRage: 0.2,
      sampleCount: 65,
      endReason: "death-correlated",
    },
  ],
  survivorHealthTraces: [
    {
      playerId: "p1",
      playerAlias: "Player 9A72F0",
      sourceSamples: 4800,
      healthCoverage: 1,
      bufferCoverage: 0.98,
      points: [
        {
          tick: 0,
          timeSeconds: 0,
          health: 100,
          maxHealth: 100,
          healthBuffer: 0,
          incapacitated: false,
        },
        {
          tick: 6000,
          timeSeconds: 200,
          health: 48,
          maxHealth: 100,
          healthBuffer: 30,
          incapacitated: false,
        },
        {
          tick: 9000,
          timeSeconds: 300,
          health: 1,
          maxHealth: 100,
          healthBuffer: 0,
          incapacitated: true,
        },
      ],
    },
  ],
  survivorLoadoutTraces: [
    {
      playerId: "p1",
      playerAlias: "Player 9A72F0",
      sourceSamples: 4800,
      coverage: { primaryWeapon: 1, firstAid: 1, temporaryHealth: 1 },
      points: [
        {
          tick: 0,
          timeSeconds: 0,
          primaryWeapon: { id: 2, name: "SMG", category: "primary" },
          firstAid: null,
          temporaryHealth: {
            id: 15,
            name: "Pain Pills",
            category: "temporary-health",
          },
        },
        {
          tick: 6000,
          timeSeconds: 200,
          primaryWeapon: {
            id: 26,
            name: "AK-47",
            category: "primary",
          },
          firstAid: null,
          temporaryHealth: null,
        },
      ],
    },
  ],
  survivorAmmoTraces: [
    {
      playerId: "p1",
      playerAlias: "Player 9A72F0",
      sourceSamples: 4800,
      coverage: 0.99,
      points: [
        {
          tick: 0,
          timeSeconds: 0,
          weaponClass: "CSubMachinegun",
          clip: 50,
          reserve: 650,
        },
        {
          tick: 3000,
          timeSeconds: 100,
          weaponClass: "CSubMachinegun",
          clip: 18,
          reserve: 500,
        },
        {
          tick: 6000,
          timeSeconds: 200,
          weaponClass: "CWeaponRifle",
          clip: 40,
          reserve: 320,
        },
      ],
    },
  ],
  players: [
    {
      id: "p1",
      alias: "Player 9A72F0",
      identity: {
        displayName: "Player 9A72F0",
        steamId64: "76561198000000000",
        steamProfileUrl:
          "https://steamcommunity.com/profiles/76561198000000000",
      },
      team: 2,
      playerClass: "survivor",
      sampleCount: 4800,
      durationSeconds: 700,
      distanceUnits: 44820,
      viewTravelDegrees: 12700,
      observedPositionRate: 1,
      observedAnglesRate: 0.96,
      weapons: ["weapon_rifle", "weapon_pistol"],
      evidenceWindows: 1,
      specialInfectedKills: 18,
      checkpointInfectedKills: 144,
      survivorDeaths: 1,
      revives: 2,
      playedSurvivor: true,
      playedInfected: true,
      infectedClasses: ["Hunter", "Smoker"],
      counters: { m_checkpointDamageToTank: 610 },
    },
    {
      id: "p2",
      alias: "Player 10BDEE",
      team: 3,
      playerClass: "hunter",
      sampleCount: 4200,
      durationSeconds: 680,
      distanceUnits: 39110,
      viewTravelDegrees: 9800,
      observedPositionRate: 0.97,
      observedAnglesRate: 0.9,
      weapons: [],
      evidenceWindows: 0,
      infectedDeaths: 7,
      specialIncaps: 3,
      pinSeconds: 12,
      playedSurvivor: true,
      playedInfected: true,
      infectedClasses: ["Hunter"],
    },
  ],
};

function analysis(id: string, mapName: string) {
  return {
    jobId: id,
    demoSha256: id.padEnd(64, "a"),
    engineResultSha256: "b".repeat(64),
    engineResult: {
      schemaVersion: 1,
      demo: { sha256: id.padEnd(64, "a"), mapName, bytes: 7_400_000, stats },
      cases: [
        {
          id: `case-${id}`,
          evidence: [{}],
          presentation: {
            evidence: [
              {
                id: "e1",
                family: "aim",
                title: "Fast view-angle transition",
                tick: 9201,
                tickRange: { start: 9198, end: 9204 },
                quality: { value: 0.72, basis: ["angles"] },
                contribution: null,
                explanation:
                  "A fast transition met the descriptive detector threshold.",
                counterevidence: [
                  "A nearby target may explain the correction.",
                ],
                limitations: [],
                demoSha256: id.padEnd(64, "a"),
                window: { startTick: 9000, endTick: 9400, contextSeconds: 8 },
              },
            ],
          },
        },
      ],
    },
  };
}

async function visualAudit(page: Page, name: string) {
  const directory = process.env.L4DSTATS_VISUAL_AUDIT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function mockAnalysis(page: Page, options: { dense?: boolean } = {}) {
  let upload = 0;
  const denseGeometry = options.dense
    ? (JSON.parse(
        readFileSync("../../map-geometry/c5m3_cemetery.json", "utf8"),
      ) as {
        positions: number[];
        indices: number[];
        bounds: {
          min: { x: number; y: number; z: number };
          max: { x: number; y: number; z: number };
        };
      })
    : undefined;
  const denseTimeline = denseGeometry
    ? Array.from({ length: 2_000 }, (_, index) => {
        const triangleCount = denseGeometry.indices.length / 3;
        const triangleOffset = ((index * 7_919) % triangleCount) * 3;
        const vertices = [0, 1, 2].map(
          (corner) => denseGeometry.indices[triangleOffset + corner]! * 3,
        );
        const centroid = (axis: 0 | 1 | 2) =>
          vertices.reduce(
            (sum, vertex) => sum + denseGeometry.positions[vertex + axis]!,
            0,
          ) / 3;
        const type =
          index === 0 || index === 1_000
            ? ("round_start" as const)
            : index === 999 || index === 1_999
              ? ("round_end" as const)
              : index % 17 === 0
                ? ("incap" as const)
                : ("attack" as const);
        return {
          tick: 100 + index * 9,
          timeSeconds: (100 + index * 9) / 30,
          type,
          actor: `Player ${index % 8}`,
          actorPlayerId: `p${(index % 8) + 1}`,
          victim: `Player ${(index + 1) % 8}`,
          victimPlayerId: `p${((index + 1) % 8) + 1}`,
          infectedClass: [
            "Hunter",
            "Smoker",
            "Charger",
            "Jockey",
            "Spitter",
            "Boomer",
          ][index % 6],
          detail:
            type === "round_start"
              ? `Observed round start ${index === 0 ? 1 : 2}`
              : type === "round_end"
                ? `Observed round end ${index < 1_000 ? 1 : 2}`
                : `Deterministic positioned event ${index + 1}`,
          position: {
            x: centroid(0),
            y: centroid(1),
            z: centroid(2),
          },
        };
      })
    : undefined;
  await page.route("**/api/maps/*/geometry", async (route) => {
    const map = route.request().url().split("/").at(-2)!;
    if (options.dense || process.env.L4DSTATS_VISUAL_AUDIT_REAL_GEOMETRY) {
      await route.fulfill({
        contentType: "application/json",
        body: readFileSync("../../map-geometry/c5m3_cemetery.json"),
      });
      return;
    }
    await route.fulfill({
      json: {
        format: "l4dstats-map-mesh-v1",
        bspVersion: 20,
        mapRevision: 1,
        positions: [0, 0, 0, 500, 0, 0, 500, 500, 0, 0, 500, 0],
        indices: [0, 1, 2, 0, 2, 3],
        triangleZ: [0, 0],
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 500, y: 500, z: 0 } },
        coverage: {
          worldFaces: 1,
          emittedFaces: 1,
          emittedTriangles: 2,
          skippedToolFaces: 0,
          skippedDisplacements: 0,
          emittedDisplacements: 0,
          rejectedFaces: 0,
          staticProps: "unavailable",
          dynamicState: "unavailable",
          compression: {
            codec: "valve-source-lzma1",
            decoder: "@napi-rs/lzma@1.5.1",
            decodedLumps: [],
            decodedBytes: 0,
          },
        },
        provenance: {
          map,
          sourceBspSha256: "c".repeat(64),
          sourceBytes: 1024,
          sourceKind: "steam-dedicated-server",
          steamAppId: 222860,
          extractor: "test",
        },
      },
    });
  });
  await page.route("**/api/uploads?*", async (route) => {
    upload += 1;
    const id = `job${upload}`;
    await route.fulfill({
      status: 202,
      json: {
        job: {
          id,
          state: "queued",
          progress: 0,
          message: null,
          source: { kind: "local" },
        },
        upload: {
          filename: `match-${upload}.dem`,
          bytes: 100,
          sha256: id.padEnd(64, "a"),
        },
      },
    });
  });
  await page.route("**/api/jobs/*", async (route) => {
    const id = route.request().url().split("/").pop()!;
    const result = analysis(
      id,
      options.dense && id === "job1"
        ? "c5m3_cemetery"
        : id === "job1"
          ? "c2m3_coaster"
          : "c2m4_barns",
    );
    if (denseTimeline && id === "job1") {
      result.engineResult.demo.stats = {
        ...stats,
        playbackTicks: 18_100,
        durationSeconds: 603.33,
        eventCount: denseTimeline.length,
        timeline: denseTimeline,
      };
    }
    await route.fulfill({
      json: {
        id,
        state: "succeeded",
        progress: 1,
        message: "Analysis complete",
        source: { kind: "local" },
        analysis: result,
      },
    });
  });
}

test("presents a focused, responsive upload-first landing page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/L4DStats/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.png",
  );
  await expect(
    page.locator('.poster-brand img[src="/art/infected-mark.webp"]'),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "L4DStats",
  );
  await expect(page.getByRole("button", { name: /drop demos/i })).toBeVisible();
  const signature = page.getByRole("link", {
    name: "Banja Labs (opens in a new tab)",
  });
  await expect(signature).toBeVisible();
  await expect(signature).toHaveAttribute(
    "href",
    "https://banja.au/?utm_source=l4dstats&utm_medium=referral&utm_campaign=l4dstats_product&utm_content=homepage_signature",
  );
  await expect(signature).toHaveAttribute("target", "_blank");
  await expect(signature).toHaveAttribute("rel", /noopener/);
  const signatureStyle = await signature.evaluate((element) => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    rect: element.getBoundingClientRect().toJSON(),
  }));
  expect(signatureStyle.fontSize).toBeGreaterThanOrEqual(11);
  expect(signatureStyle.rect.x).toBeLessThan(80);
  expect(signatureStyle.rect.bottom).toBeGreaterThan(
    (page.viewportSize()?.height ?? 720) - 70,
  );
  await expect(
    page.getByRole("link", { name: "Email Banja Labs at labs@banja.au" }),
  ).toHaveAttribute("href", "mailto:labs@banja.au");
  const emailIcon = page.locator(".banja-email svg");
  const [signatureBounds, emailBounds] = await Promise.all([
    signature.boundingBox(),
    emailIcon.boundingBox(),
  ]);
  expect(signatureBounds).not.toBeNull();
  expect(emailBounds).not.toBeNull();
  expect(
    emailBounds!.x - (signatureBounds!.x + signatureBounds!.width),
  ).toBeGreaterThanOrEqual(4);
  expect(
    emailBounds!.x - (signatureBounds!.x + signatureBounds!.width),
  ).toBeLessThanOrEqual(10);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const width = await page.evaluate(() => [
    document.documentElement.clientWidth,
    document.documentElement.scrollWidth,
  ]);
  expect(width[1]).toBeLessThanOrEqual(width[0] + 1);
});

test("keeps the reusable Banja contact signature on the loading state", async ({
  page,
}) => {
  await mockAnalysis(page);
  await page.route("**/api/jobs/*", (route) =>
    route.fulfill({
      json: {
        id: "job1",
        state: "running",
        progress: 0.42,
        message: "Reconstructing evidence",
        source: { kind: "local" },
      },
    }),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "loading.dem",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("HL2DEMO-loading"),
  });
  const loadingAttribution = page.locator(".banja-attribution-loading");
  await expect(loadingAttribution).toBeVisible();
  await expect(
    loadingAttribution.getByRole("link", {
      name: "Banja Labs (opens in a new tab)",
    }),
  ).toHaveAttribute("href", /utm_content=loading_signature/);
  await expect(
    loadingAttribution.getByRole("link", {
      name: "Email Banja Labs at labs@banja.au",
    }),
  ).toHaveAttribute("href", "mailto:labs@banja.au");
});

test("uploads multiple demos in parallel and exposes deep statistics", async ({
  page,
}) => {
  await mockAnalysis(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "first.dem",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("HL2DEMO-one"),
    },
    {
      name: "second.dem",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("HL2DEMO-two"),
    },
  ]);
  await expect(
    page.getByRole("heading", { name: "c2m3_coaster" }),
  ).toBeVisible();
  const reportAttribution = page.locator(".banja-attribution-report");
  await expect(
    reportAttribution.getByRole("link", {
      name: "Banja Labs (opens in a new tab)",
    }),
  ).toHaveAttribute("href", /utm_content=report_signature/);
  await expect(
    reportAttribution.getByRole("link", {
      name: "Email Banja Labs at labs@banja.au",
    }),
  ).toHaveAttribute("href", "mailto:labs@banja.au");
  await expect(
    page.getByText("636 : 482", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("Round progression").first()).toBeVisible();
  await expect(page.getByText("MVP unavailable")).toBeVisible();
  await expect(page.locator(".overview-metrics .mini-bars")).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) > 700) {
    const finalScoreBounds = await page
      .locator(".game-result-final")
      .boundingBox();
    const firstMapBounds = await page
      .locator(".map-score-strip > div")
      .first()
      .boundingBox();
    expect(finalScoreBounds).not.toBeNull();
    expect(firstMapBounds).not.toBeNull();
    expect(finalScoreBounds!.x + finalScoreBounds!.width).toBeLessThanOrEqual(
      firstMapBounds!.x + 1,
    );
  }
  if ((await page.evaluate(() => window.innerWidth)) <= 700) {
    const overviewMetrics = await page
      .locator(".overview-metrics .stat-card")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect();
          return { y: box.y, width: box.width, height: box.height };
        }),
      );
    expect(overviewMetrics).toHaveLength(4);
    expect(
      Math.abs(overviewMetrics[0]!.y - overviewMetrics[1]!.y),
    ).toBeLessThan(1);
    expect(overviewMetrics.every((metric) => metric.width >= 150)).toBe(true);
  }
  await visualAudit(page, "overview");
  await page.locator(".round-progression-detail summary").click();
  await expect(
    page.getByText(/first half · neutral roster labels/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open analysis for c2m3_coaster" }),
  ).toHaveAttribute("href", "/analysis/job1/overview");
  await page.getByRole("button", { name: "players" }).click();
  await expect(page.locator(".tab-panel > .table-wrap tbody tr")).toHaveCount(
    3,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 1));
  if ((await page.evaluate(() => window.innerWidth)) <= 700)
    expect(
      await page
        .locator(".table-wrap")
        .first()
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
  await expect(page.getByText("Player 9A72F0").first()).toBeVisible();
  await expect(page.getByText("L4DStats Rating")).toBeVisible();
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
  const help = page.locator(".header-help button").first();
  await help.focus();
  const helpBounds = await page.locator(".header-help-tooltip").boundingBox();
  expect(helpBounds).not.toBeNull();
  expect(helpBounds!.x).toBeGreaterThanOrEqual(0);
  expect(helpBounds!.x + helpBounds!.width).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  expect(helpBounds!.y).toBeGreaterThanOrEqual(0);
  expect(helpBounds!.y + helpBounds!.height).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight),
  );
  await expect(
    page.getByRole("columnheader", { name: "Class / team" }),
  ).toHaveCount(0);
  const advanced = page.locator(".advanced-player-data");
  await advanced.locator(":scope > summary").click();
  await expect(page.getByText("Sampled health traces")).toBeVisible();
  await expect(page.getByText("Networked loadouts")).toBeVisible();
  await expect(page.getByText("AK-47").first()).toBeVisible();
  await expect(page.getByText("Sampled active ammo").first()).toBeVisible();
  await expect(page.getByText("40 / 320").first()).toBeVisible();
  await expect(page.getByText("Side-swap reconstruction")).toBeVisible();
  await expect(page.getByText("Roster A").first()).toBeVisible();
  await expect(page.locator(".source-badge.counter").first()).toBeVisible();
  await expect(page.locator(".source-badge.sampled").first()).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Sampled Survivor health on c2m3_coaster/ }),
  ).toBeVisible();
  await visualAudit(page, "players");
  const mapToggle = page.locator(".map-toggle:not(.half-toggle)");
  await mapToggle.locator("summary").click();
  await mapToggle.locator("input").nth(1).uncheck();
  await expect(mapToggle).not.toHaveAttribute("open", "");
  await mapToggle.locator("summary").click();
  await mapToggle.locator("input").nth(1).check();
  await expect(mapToggle).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "combat" }).click();
  await expect(page.getByText("Who killed what, and how")).toBeVisible();
  if ((await page.evaluate(() => window.innerWidth)) <= 700) {
    const metricCards = page.locator(".combat-metrics .stat-card");
    const boxes = await metricCards.evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    expect(boxes).toHaveLength(4);
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes.every((box) => box.width >= 150 && box.height <= 140)).toBe(
      true,
    );
  }
  await expect(page.getByText("Hit clusters")).toBeVisible();
  await expect(page.getByText("Control and outcome")).toBeVisible();
  await expect(
    page.getByText("Rage, fire, and observed outcome"),
  ).toBeVisible();
  await expect(page.getByText("Death correlated").first()).toBeVisible();
  await expect(page.getByText(/actual BSP geometry/)).toBeVisible();
  await expect(page.getByText("Observed Survivor opening area")).toBeVisible();
  await expect(
    page.getByText(/demo-derived, not an authored saferoom/),
  ).toBeVisible();
  expect(
    await page.locator(".hit-board > div:visible").count(),
  ).toBeLessThanOrEqual(8);
  const spatialWorkspace = page.locator(".spatial-workspace");
  await expect(spatialWorkspace.locator("canvas")).toHaveCount(1);
  await expect(spatialWorkspace.locator(".death-map h3")).toContainText(
    "c2m3_coaster",
  );
  await expect(
    spatialWorkspace.getByRole("button", { name: "Fit map" }),
  ).toBeVisible();
  await expect(
    spatialWorkspace.getByRole("button", { name: "hybrid" }),
  ).toHaveAttribute("aria-pressed", "true");
  await spatialWorkspace.getByRole("button", { name: "density" }).click();
  await expect(
    spatialWorkspace.getByRole("button", { name: "density" }),
  ).toHaveAttribute("aria-pressed", "true");
  if ((page.viewportSize()?.width ?? 0) <= 700)
    await spatialWorkspace.getByText("Map filters", { exact: true }).click();
  await spatialWorkspace.getByLabel("Moments").selectOption("critical");
  await expect(
    spatialWorkspace.getByText(/positioned moments/).first(),
  ).toBeVisible();
  const spatialCanvas = spatialWorkspace.locator("canvas");
  const spatialEventLinks = spatialWorkspace.locator(".spatial-event-links");
  await expect(spatialEventLinks.locator("button")).toHaveCount(0);
  await spatialEventLinks.locator("summary").click();
  expect(await spatialEventLinks.locator("button").count()).toBeLessThanOrEqual(
    101,
  );
  await spatialEventLinks.locator("summary").click();
  await spatialCanvas.hover({ position: { x: 220, y: 180 } });
  await page.waitForTimeout(100);
  const rendersBeforeWheelBurst = Number(
    await spatialCanvas.getAttribute("data-render-count"),
  );
  await spatialCanvas.evaluate((canvas) => {
    for (let index = 0; index < 80; index += 1) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 220,
          clientY: 180,
          deltaY: index % 2 ? 2 : -2,
        }),
      );
    }
  });
  await page.waitForTimeout(50);
  const rendersAfterWheelBurst = Number(
    await spatialCanvas.getAttribute("data-render-count"),
  );
  expect(rendersAfterWheelBurst - rendersBeforeWheelBurst).toBeLessThanOrEqual(
    3,
  );
  const pageScrollBeforeMapZoom = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -500);
  await expect(spatialWorkspace.getByText("1.00×")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(
    pageScrollBeforeMapZoom,
  );
  await spatialWorkspace.getByRole("button", { name: "Fit map" }).click();
  await expect(spatialWorkspace.getByText("1.00×")).toBeVisible();
  await spatialWorkspace.getByRole("button", { name: "hybrid" }).click();
  await page
    .getByRole("button", { name: "Show spatial combat for c2m4_barns" })
    .click();
  await expect(spatialWorkspace.locator("canvas")).toHaveCount(1);
  await expect(spatialWorkspace.locator(".death-map h3")).toContainText(
    "c2m4_barns",
  );
  await expect(page.locator(".tank-board")).toContainText("c2m4_barns");
  await page
    .getByRole("button", { name: "Show spatial combat for c2m3_coaster" })
    .click();
  await visualAudit(page, "combat");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 1));
  await expect(page.getByText(/Inspect .* positioned moments/)).toBeVisible();
  const combatHistoryLength = await page.evaluate(() => window.history.length);
  await page
    .locator(".hit-board")
    .getByRole("button", { name: "View tick 8900 on timeline" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/timeline\?demo=.*&tick=8900(?:&|$)/);
  expect(await page.evaluate(() => window.history.length)).toBe(
    combatHistoryLength,
  );
  await expect(page.getByText("8 tick-addressed moments")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Story" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".story-round-divider")).toContainText(
    "Unsegmented",
  );
  const storyTab = page.getByRole("tab", { name: "Story" });
  await storyTab.focus();
  await storyTab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Timeline" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Timeline" }).press("ArrowLeft");
  await expect(storyTab).toHaveAttribute("aria-selected", "true");
  const compactStoryEvents = page.locator(".story-event-row");
  await expect(
    compactStoryEvents.filter({ hasText: "2 linked moments" }).first(),
  ).toBeVisible();
  await expect(page.locator(".story-event-tank_control")).toBeVisible();
  await expect(page.locator(".story-event-round_end")).toBeVisible();
  const compactStoryEventHeights = await compactStoryEvents.evaluateAll(
    (rows) => rows.map((row) => row.getBoundingClientRect().height),
  );
  expect(Math.max(...compactStoryEventHeights)).toBeLessThanOrEqual(72);
  await compactStoryEvents.first().click();
  await expect(page.locator(".story-inspector")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect on Timeline" }),
  ).toBeVisible();
  const hitSummary = page.locator(".hit-summary-card:not(.story-event-row)");
  await expect(hitSummary).toHaveCount(1);
  await expect(hitSummary).toContainText("Unsegmented · Hit 01");
  await expect(hitSummary.locator(".infected-icon")).toBeVisible();
  await expect(hitSummary).toContainText("Player 10BDEE");
  await expect(hitSummary).toContainText("Hunter");
  await expect(hitSummary).toContainText("observed HP loss");
  await hitSummary.click();
  await expect(page.locator(".hit-inspector")).toContainText(
    "18 observed HP loss",
  );
  await expect(
    page.getByRole("button", { name: "Inspect hit range" }),
  ).toBeVisible();
  await visualAudit(page, "story");
  if ((page.viewportSize()?.width ?? 0) <= 700)
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .locator(".timeline-filters")
    .getByRole("button", { name: "support", exact: true })
    .click();
  await expect(
    page.getByText(
      "No major story moments match the current map and category filters.",
    ),
  ).toBeVisible();
  await page
    .locator(".timeline-filters")
    .getByRole("button", { name: "all", exact: true })
    .click();
  await page
    .locator(".timeline-filters")
    .getByRole("button", { name: "spacious", exact: true })
    .click();
  await expect(page.locator(".hit-roundup")).toHaveClass(/hit-density-4/);
  await page
    .locator(".timeline-view-tabs")
    .getByRole("tab", { name: "Timeline" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.fromEntries(new URLSearchParams(location.search)),
      ),
    )
    .toMatchObject({
      storyView: "timeline",
      storyFilter: "all",
      storyDensity: "4",
    });
  await expect(page.getByText("One independent clock per demo")).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) <= 700) {
    await expect(page.locator(".mobile-timeline-list")).toBeVisible();
    await expect(page.locator(".match-timeline")).toHaveCount(0);
    const mobileEvents = page.locator(".mobile-timeline-event");
    expect(await mobileEvents.count()).toBeGreaterThan(0);
    expect(await mobileEvents.count()).toBeLessThanOrEqual(100);
    await mobileEvents.first().click();
    await expect(page.locator(".timeline-focus")).toBeVisible();
    await page.getByRole("button", { name: "Lane chart" }).click();
  }
  await expect(page.getByText("SI actions", { exact: true })).toBeVisible();
  await expect(page.getByText("Pins + clears", { exact: true })).toBeVisible();
  await expect(page.getByText("Bosses", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-lane")).toHaveCount(6);
  await expect(page.locator(".timeline-band.hit").first()).toBeVisible();
  await expect(page.locator(".timeline-band.pin").first()).toBeVisible();
  await expect(page.locator(".timeline-band.tank").first()).toBeVisible();
  await expect(
    page.locator('.infected-icon[data-infected-class="Hunter"]').first(),
  ).toBeVisible();
  await expect(
    page.locator(".timeline-lane button.infected-marker").first(),
  ).not.toContainText("HU");
  const infectedMarker = page
    .locator(".timeline-lane button.infected-marker")
    .first();
  const infectedMarkerStyle = await infectedMarker.evaluate((element) => {
    const markerStyle = getComputedStyle(element);
    const icon = element.querySelector(".infected-icon");
    const iconStyle = icon ? getComputedStyle(icon) : null;
    return {
      background: markerStyle.backgroundColor,
      iconWidth: iconStyle ? Number.parseFloat(iconStyle.width) : 0,
      iconHeight: iconStyle ? Number.parseFloat(iconStyle.height) : 0,
    };
  });
  expect(infectedMarkerStyle.background).toBe("rgba(0, 0, 0, 0)");
  expect(infectedMarkerStyle.iconWidth).toBeGreaterThanOrEqual(28);
  expect(infectedMarkerStyle.iconHeight).toBeGreaterThanOrEqual(28);
  const firstTimelineMarker = page.locator(".timeline-lane button").first();
  await firstTimelineMarker.click({ force: true });
  await expect(firstTimelineMarker).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".timeline-focus")).toBeVisible();
  await expect
    .poll(async () => {
      const marker = await firstTimelineMarker.boundingBox();
      const label = await firstTimelineMarker
        .locator("xpath=ancestor::div[contains(@class,'timeline-lane')]/strong")
        .boundingBox();
      return marker && label ? marker.x - (label.x + label.width) : -1;
    })
    .toBeGreaterThan(0);
  if ((page.viewportSize()?.width ?? 0) > 700) {
    await firstTimelineMarker.hover({ force: true });
    const floatingTooltip = page.locator("body > .timeline-float-tooltip");
    await expect(floatingTooltip).toBeVisible();
    expect(
      await floatingTooltip.evaluate((element) =>
        Number.parseInt(getComputedStyle(element).zIndex, 10),
      ),
    ).toBeGreaterThan(10000);
  }
  await page.getByRole("button", { name: "Open fullscreen timeline" }).click();
  await expect(page.locator(".timeline-panel")).toHaveClass(/is-fullscreen/);
  await page.getByRole("button", { name: "Exit fullscreen timeline" }).click();
  await visualAudit(page, "timeline");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 1));
  if ((await page.evaluate(() => window.innerWidth)) <= 700)
    expect(
      await page
        .locator(".timeline-scroll")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
  await page
    .getByRole("button", { name: /cleared Player/ })
    .first()
    .click();
  await expect(page.getByText(/cleared Player/).first()).toBeVisible();
  await page.getByRole("button", { name: "signals" }).click();
  await expect(page.getByText("Signals are not verdicts")).toBeVisible();
  await visualAudit(page, "signals");
  const historyLength = await page.evaluate(() => window.history.length);
  await page
    .getByRole("button", { name: /View tick .* on timeline/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/timeline\?demo=.*&tick=\d+(?:&|$)/);
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
  await page
    .locator(".timeline-view-tabs")
    .getByRole("tab", { name: "Timeline" })
    .click();
  await expect(page.locator(".timeline-focus")).toContainText("tick");
  await page.getByRole("button", { name: "data coverage" }).click();
  await expect(
    page.getByText("What could be reconstructed, and what could not"),
  ).toBeVisible();
  await expect(page.locator(".source-badge.observed").first()).toBeVisible();
  await expect(page.locator(".source-badge.unavailable").first()).toBeVisible();
  await expect(
    page.getByText("What this report can and cannot prove"),
  ).toBeVisible();
  await expect(page.getByText("Cheating verdict")).toBeVisible();
  await visualAudit(page, "quality");
  if ((await page.evaluate(() => window.innerWidth)) <= 700) {
    const undersizedTargets = await page
      .locator("button, summary, input[type='checkbox']")
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          if ((element as HTMLElement).offsetParent === null) return [];
          const target =
            element instanceof HTMLInputElement
              ? (element.closest("label") ?? element)
              : element;
          const box = target.getBoundingClientRect();
          return box.width < 24 || box.height < 24
            ? [
                {
                  tag: element.tagName,
                  label:
                    element.getAttribute("aria-label") ??
                    element.textContent?.trim().slice(0, 60),
                  width: Math.round(box.width),
                  height: Math.round(box.height),
                },
              ]
            : [];
        }),
      );
    expect(undersizedTargets).toEqual([]);
  }
});

test("bounds dense spatial interaction on the heaviest committed Parish geometry", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const durations: number[] = [];
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) durations.push(entry.duration);
    }).observe({ entryTypes: ["longtask"] });
    (
      window as typeof window & {
        __l4dstatsLongTasks: number[];
      }
    ).__l4dstatsLongTasks = durations;
  });
  await mockAnalysis(page, { dense: true });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "dense-c5m3.dem",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("HL2DEMO-dense-c5m3"),
  });
  await expect(
    page.getByRole("heading", { name: "c5m3_cemetery" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "combat" }).click();
  const workspace = page.locator(".spatial-workspace");
  await expect(
    workspace.getByText("2000 positioned combat moments on c5m3_cemetery"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    workspace.getByText(/71,551 world-brush triangles/),
  ).toBeVisible();
  await expect(
    workspace.getByText("Observed progression anchors"),
  ).toBeVisible();
  await expect(workspace.getByText("First/last observed")).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "Review", exact: true }),
  ).toHaveClass(/active/);
  await workspace
    .getByRole("button", { name: "Critical outcomes", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Critical outcomes", exact: true }),
  ).toHaveClass(/active/);
  await workspace.getByRole("button", { name: "Review", exact: true }).click();
  const filterDrawer = workspace.locator(".spatial-filter-drawer");
  if ((page.viewportSize()?.width ?? 0) <= 700) {
    await expect(filterDrawer).not.toHaveAttribute("open", "");
    expect((await filterDrawer.boundingBox())?.height).toBeLessThanOrEqual(48);
  }
  await expect(workspace.locator(".spatial-event-links button")).toHaveCount(0);
  await visualAudit(page, "dense-events");
  await workspace.getByRole("button", { name: "density", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: "density", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await visualAudit(page, "dense-density");
  await workspace.getByRole("button", { name: "Compare teams" }).click();
  await expect(workspace.getByText(/A \d+ · B \d+ · unassigned/)).toBeVisible();
  await visualAudit(page, "dense-difference");
  await workspace.getByRole("button", { name: "split", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: "split", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const expectedSplitLayout =
    (page.viewportSize()?.width ?? 0) <= 700 ? "stacked" : "side-by-side";
  await expect(workspace.locator("canvas")).toHaveAttribute(
    "data-comparison-layout",
    expectedSplitLayout,
  );
  await expect(workspace.getByText(/A \d+ · B \d+ · unassigned/)).toBeVisible();
  await visualAudit(page, "dense-split");
  await workspace
    .getByRole("button", { name: "difference", exact: true })
    .click();
  await workspace.getByRole("button", { name: "hybrid", exact: true }).click();

  const canvas = workspace.locator("canvas");
  await expect(canvas).toHaveAttribute("data-render-count", /\d+/);
  await expect(canvas).toHaveAttribute("data-scale-units", /[1-9]\d*/);
  await expect(canvas).toHaveAttribute("data-cluster-count", /[1-9]\d*/);
  await canvas.focus();
  await canvas.press("Enter");
  await expect(workspace.getByText(/Explored cluster/)).toBeVisible();
  await expect(workspace.getByText(/positioned moments/).last()).toBeVisible();
  await workspace.getByRole("button", { name: "Dismiss" }).click();
  await workspace.getByRole("button", { name: "Fit map" }).click();
  await page.waitForTimeout(100);
  const before = Number(await canvas.getAttribute("data-render-count"));
  await page.evaluate(() => {
    (
      window as typeof window & {
        __l4dstatsLongTasks: number[];
      }
    ).__l4dstatsLongTasks.length = 0;
  });
  const lowZoomMetrics = await canvas.evaluate(async (element) => {
    const drawDurations: number[] = [];
    const inputToFrame: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      const inputAt = performance.now();
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 420,
          clientY: 260,
          deltaY: index % 2 ? 5 : -5,
        }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      inputToFrame.push(performance.now() - inputAt);
      drawDurations.push(Number(element.dataset.drawDuration ?? 0));
    }
    return { drawDurations, inputToFrame };
  });
  const after = Number(await canvas.getAttribute("data-render-count"));
  expect(after - before).toBeGreaterThanOrEqual(30);
  expect(after - before).toBeLessThanOrEqual(62);
  const percentile = (values: number[], percentileValue: number) => {
    const ordered = [...values].sort((left, right) => left - right);
    return (
      ordered[
        Math.min(
          ordered.length - 1,
          Math.ceil(ordered.length * percentileValue) - 1,
        )
      ] ?? 0
    );
  };
  expect(percentile(lowZoomMetrics.drawDurations, 0.95)).toBeLessThanOrEqual(
    24,
  );
  expect(percentile(lowZoomMetrics.inputToFrame, 0.95)).toBeLessThanOrEqual(34);
  const highZoomMetrics = await canvas.evaluate(async (element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 420,
        clientY: 260,
        deltaY: -1_200,
      }),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const drawDurations: number[] = [];
    const inputToFrame: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const inputAt = performance.now();
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 420,
          clientY: 260,
          deltaY: index % 2 ? 3 : -3,
        }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      inputToFrame.push(performance.now() - inputAt);
      drawDurations.push(Number(element.dataset.drawDuration ?? 0));
    }
    return {
      detail: element.dataset.geometryDetail,
      drawDurations,
      inputToFrame,
    };
  });
  expect(highZoomMetrics.detail).toBe("raster");
  expect(percentile(highZoomMetrics.drawDurations, 0.95)).toBeLessThanOrEqual(
    24,
  );
  expect(percentile(highZoomMetrics.inputToFrame, 0.95)).toBeLessThanOrEqual(
    34,
  );
  await page.waitForTimeout(240);
  await expect(canvas).toHaveAttribute("data-geometry-detail", "vector");
  expect(
    Number(await canvas.getAttribute("data-draw-duration")),
  ).toBeLessThanOrEqual(48);
  const longTasks = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __l4dstatsLongTasks: number[];
        }
      ).__l4dstatsLongTasks,
  );
  expect(longTasks.filter((duration) => duration >= 50)).toHaveLength(0);
  if (!(await filterDrawer.evaluate((element) => element.hasAttribute("open"))))
    await filterDrawer.locator("summary").click();
  await workspace.getByLabel("Moments").selectOption("boss");
  await expect(
    workspace.getByText("No positioned moments match these filters"),
  ).toBeVisible();
  await expect(workspace.locator("canvas")).toBeVisible();
  await workspace.getByRole("button", { name: "Clear filters" }).click();
  await expect(
    workspace.getByText("No positioned moments match these filters"),
  ).toHaveCount(0);
  await expect(
    workspace.getByText("2000 positioned combat moments on c5m3_cemetery"),
  ).toBeVisible();
  await page.getByRole("button", { name: "timeline", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Story" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await page.locator(".hit-summary-card").count()).toBeLessThanOrEqual(
    100,
  );
  await expect(page.locator(".story-round-divider")).toContainText([
    "Round 1",
    "Round 2",
  ]);
  await expect(page.locator(".story-show-more")).toBeVisible();
  await visualAudit(page, "dense-story");
});

test("rejects an upload batch above the ten-demo limit", async ({ page }) => {
  let uploadRequests = 0;
  await page.route("**/api/uploads?*", async (route) => {
    uploadRequests += 1;
    await route.abort();
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 11 }, (_, index) => ({
      name: `match-${index + 1}.dem`,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(`HL2DEMO-${index + 1}`),
    })),
  );
  await expect(page.getByRole("alert")).toHaveText(
    "You can analyze up to 10 demos at once.",
  );
  expect(uploadRequests).toBe(0);
});

test("restores a persisted analysis at its dedicated URL", async ({ page }) => {
  await page.route("**/api/jobs/shared-job", async (route) => {
    await route.fulfill({
      json: {
        id: "shared-job",
        state: "succeeded",
        progress: 1,
        message: "Analysis complete",
        source: { kind: "local" },
        analysis: analysis("shared-job", "c2m5_concert"),
      },
    });
  });
  await page.goto("/analysis/shared-job/timeline");
  await expect(page).toHaveURL(/\/analysis\/shared-job\/timeline(?:\?|$)/);
  await expect(
    page.getByRole("button", { name: "timeline", exact: true }),
  ).toHaveClass(/active/);
  const historyLength = await page.evaluate(() => window.history.length);
  for (const tab of [
    "overview",
    "players",
    "combat",
    "timeline",
    "signals",
    "data coverage",
  ]) {
    await page
      .getByLabel("Statistics sections")
      .getByRole("button", { name: tab, exact: true })
      .click();
    const route = tab === "data coverage" ? "quality" : tab;
    await expect(page).toHaveURL(
      new RegExp(`/analysis/shared-job/${route}(?:\\?|$)`),
    );
    expect(await page.evaluate(() => window.history.length)).toBe(
      historyLength,
    );
  }
  await expect(
    page.getByRole("heading", { level: 1, name: "c2m5_concert" }),
  ).toBeVisible();
});

test("restores a complete grouped game and scopes every tab by enabled maps", async ({
  page,
}) => {
  const first = {
    ...analysis("game-job-1", "c4m1_milltown_a"),
    gameId: "game-1",
  };
  const second = {
    ...analysis("game-job-2", "c4m2_sugarmill_a"),
    gameId: "game-1",
  };
  await page.route("**/api/games/game-1", (route) =>
    route.fulfill({
      json: {
        id: "game-1",
        confidence: "high",
        evidence: ["source-server-count"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        // API arrival order is deliberately reversed. Presentation order comes
        // from the embedded cXmY map ordinal, never upload order.
        analyses: [second, first],
      },
    }),
  );
  await page.goto("/game/game-1/timeline");
  await expect(page).toHaveURL(/\/game\/game-1\/timeline(?:\?|$)/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Hard Rain" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Story" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: "All maps" })).toHaveCount(0);
  await page.getByRole("button", { name: "c4m2_sugarmill_a" }).click();
  await page.getByRole("tab", { name: "Timeline" }).click();
  if ((page.viewportSize()?.width ?? 0) <= 700)
    await page.getByRole("button", { name: "Lane chart" }).click();
  await expect(page.locator(".match-timeline")).toHaveCount(1);
  await expect(page.locator(".match-timeline h3")).toHaveText(
    "c4m2_sugarmill_a",
  );
  await expect(page.getByText("2 maps grouped as one game")).toBeVisible();
  const historyLength = await page.evaluate(() => window.history.length);
  await page.locator(".half-toggle summary").click();
  await page.locator(".half-toggle input").first().uncheck();
  await expect(page.locator(".match-timeline")).toHaveCount(1);
  await page.locator(".half-toggle input").first().check();
  await expect(page.locator(".match-timeline")).toHaveCount(1);
  await page.locator(".map-toggle:not(.half-toggle) summary").click();
  await expect(
    page.locator(".map-toggle:not(.half-toggle) label strong"),
  ).toHaveText(["c4m1_milltown_a", "c4m2_sugarmill_a"]);
  await page.locator(".map-toggle:not(.half-toggle) input").nth(1).uncheck();
  await expect(page.locator(".match-timeline")).toHaveCount(1);
  for (const tab of [
    "overview",
    "players",
    "combat",
    "timeline",
    "signals",
    "data coverage",
  ]) {
    await page
      .getByLabel("Statistics sections")
      .getByRole("button", { name: tab, exact: true })
      .click();
    const route = tab === "data coverage" ? "quality" : tab;
    await expect(page).toHaveURL(new RegExp(`/game/game-1/${route}(?:\\?|$)`));
    expect(await page.evaluate(() => window.history.length)).toBe(
      historyLength,
    );
  }
  await page
    .getByLabel("Statistics sections")
    .getByRole("button", { name: "players", exact: true })
    .click();
  const playerLink = page.locator(".player-name-link").first();
  await expect(playerLink).toHaveAttribute("href", /\/game\/game-1\/player\//);
  await expect(
    page.getByTitle(/Open .* Steam profile/).first(),
  ).toHaveAttribute(
    "href",
    "https://steamcommunity.com/profiles/76561198000000000",
  );
  const playerName = (await playerLink.textContent())!.trim();
  await playerLink.click();
  await expect(page).toHaveURL(/\/game\/game-1\/player\//);
  await expect(
    page.getByRole("heading", { level: 2, name: playerName }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Map contributions" }),
  ).toBeVisible();
});

test("moves a single completed upload onto its analysis URL", async ({
  page,
}) => {
  await mockAnalysis(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "single.dem",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("HL2DEMO-single"),
  });
  await expect(page).toHaveURL(/\/analysis\/job1\/overview$/);
  await expect(
    page.getByRole("heading", { name: "c2m3_coaster" }),
  ).toBeVisible();
});

test("honours reduced motion and has named interactive controls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const unnamed = await page
    .locator("button, input, select")
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (node) =>
            !(
              node.getAttribute("aria-label") ??
              node.textContent ??
              ""
            ).trim() && !(node as HTMLInputElement).labels?.length,
        )
        .map((node) => node.outerHTML),
    );
  expect(unnamed).toEqual([]);
  const animations = await page
    .locator("*")
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => getComputedStyle(node).animationName !== "none")
          .length,
    );
  expect(animations).toBe(0);
});
