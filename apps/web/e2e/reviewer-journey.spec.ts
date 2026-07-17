import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

function monitorRuntime(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    failures.push(
      `request: ${request.method()} ${request.url()} — ${request.failure()?.errorText}`,
    ),
  );
  return failures;
}

async function expectNoRuntimeFailures(failures: string[]) {
  expect(failures, failures.join("\n")).toEqual([]);
}

test.describe("local reviewer workflow", () => {
  test("renders a dynamically returned production case through presentation v1", async ({
    page,
  }) => {
    const detail = {
      id: "dynamic-api-case-91",
      playerKey: "privacy-token-91",
      status: "unreviewed",
      scoreJson: "{}",
      score: { status: "ranked-evidence" },
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      presentation: {
        schemaVersion: 1,
        id: "dynamic-api-case-91",
        alias: "API Player 91",
        identityLabel: "stable privacy token · epoch 3",
        provenance: { controlledFixture: false, label: "API-backed test case" },
        demos: [
          {
            id: "api-demo-1",
            sha256: "a".repeat(64),
            mapName: "c1m2_streets",
            sourceLabel: "local API artifact",
            quality: { value: 0.74, basis: ["pose and angle availability"] },
            corroboration: "same-stable-player",
          },
          {
            id: "api-demo-2",
            sha256: "b".repeat(64),
            mapName: "c1m3_mall",
            sourceLabel: "second ingested API artifact",
            quality: { value: 0.81, basis: ["bounded telemetry coverage"] },
            corroboration: "same-stable-player",
          },
        ],
        evidence: [
          {
            id: "api-evidence-1",
            family: "awareness",
            title: "API-provided alignment window",
            tick: 9000,
            tickRange: { start: 8744, end: 9256 },
            quality: { value: 0.74, basis: ["pose availability"] },
            contribution: null,
            explanation: "Versioned API explanation.",
            counterevidence: ["Target may have been audible."],
            limitations: ["Dynamic occluders unavailable."],
            demoSha256: "a".repeat(64),
            window: { startTick: 8744, endTick: 9256, contextSeconds: 8 },
          },
          {
            id: "api-evidence-2",
            family: "aim",
            title: "Second-demo API evidence",
            tick: 12000,
            tickRange: { start: 11998, end: 12002 },
            quality: { value: 0.81, basis: ["angle availability"] },
            contribution: null,
            explanation: "Evidence attached to the second ingested demo.",
            counterevidence: ["A common choke can explain pre-aim."],
            limitations: ["Input sensitivity unavailable."],
            demoSha256: "b".repeat(64),
            window: { startTick: 11744, endTick: 12256, contextSeconds: 8 },
          },
        ],
        association: {
          kind: "stable-privacy-token",
          stableToken: "privacy-token-91",
          corroboratingDemoCount: 1,
          explanation: "Two independently ingested associated demos.",
        },
        summary: {
          encounterCount: 2,
          independentSignalFamilies: ["awareness", "aim"],
        },
      },
    };
    const canonicalReport = JSON.stringify({
      schemaVersion: 1,
      caseId: detail.id,
      presentation: detail.presentation,
    });
    const reportSha = createHash("sha256")
      .update(canonicalReport)
      .digest("hex");
    await page.route("**/api/cases/dynamic-api-case-91", (route) =>
      route.fulfill({ json: detail }),
    );
    await page.route("**/api/cases/dynamic-api-case-91/notes", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await page.route("**/api/cases/dynamic-api-case-91/report", (route) =>
      route.fulfill({
        json: { sha256: reportSha, canonicalJson: canonicalReport },
      }),
    );
    await page.route(
      "**/api/cases/dynamic-api-case-91/telemetry?*",
      (route) => {
        const url = new URL(route.request().url());
        const startTick = Number(url.searchParams.get("start"));
        const endTick = Number(url.searchParams.get("end"));
        const requestedDemo = url.searchParams.get("demo");
        expect(requestedDemo).toBe("b".repeat(64));
        return route.fulfill({
          json: {
            caseId: detail.id,
            demoSha256: requestedDemo,
            startTick,
            endTick,
            chunks: [
              {
                bounded: true,
                poses: [
                  {
                    tick: startTick + 256,
                    subject: [22, 22],
                    target: [33, 33],
                  },
                ],
              },
            ],
          },
        });
      },
    );
    await page.goto("/#case/dynamic-api-case-91");
    await expect(
      page.getByRole("heading", { name: "API Player 91" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "API-provided alignment window" }),
    ).toBeVisible();
    await expect(
      page.getByText("Target may have been audible.", { exact: true }).last(),
    ).toBeVisible();
    await expect(page.getByText("contribution unavailable")).toHaveCount(2);
    await expect(page.getByText(/Controlled seeded example/)).toHaveCount(0);
    const comparison = page.getByLabel("Cross-demo evidence comparison");
    await expect(comparison).toContainText("c1m2_streets");
    await expect(comparison).toContainText("c1m3_mall");
    await expect(comparison).toContainText("Cross-demo persistence");
    const reportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: /export manifest/i }).click();
    expect((await reportDownload).suggestedFilename()).toBe(
      `dynamic-api-case-91-${reportSha}.report.json`,
    );
    await page
      .getByRole("button", { name: /Second-demo API evidence/i })
      .click();
    await expect(
      page.getByRole("heading", { name: "Second-demo API evidence" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /inspect 8-second context/i })
      .click();
    await expect(page).toHaveURL(
      /#demo\/api-demo-2\?tick=12000&case=dynamic-api-case-91$/,
    );
    await expect(
      page.getByRole("heading", { name: "c1m3_mall" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "1 bounded chunk · 1 poses returned",
    );
    await expect(page.getByRole("status")).toContainText(
      `demo ${"b".repeat(64)}`,
    );
  });

  test("validates, queues, and cancels an allowlisted ingest", async ({
    page,
  }) => {
    const failures = monitorRuntime(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Ingest demo" }).click();
    await expect(
      page.getByRole("dialog", { name: /add a demo/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Allowlisted URL" }).click();
    await page
      .getByLabel("HTTPS URL")
      .fill(`https://cedapug.com/demos/e2e-${page.viewportSize()!.width}.zip`);
    await page.getByRole("button", { name: /validate & queue/i }).click();
    await expect(page.getByRole("status")).toContainText("queued");
    await page.getByRole("button", { name: "Cancel job" }).click();
    await expect(page.getByRole("status")).toContainText("cancelled");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expectNoRuntimeFailures(failures);
  });

  test("triages a case, follows a finding deep link, and inspects eight seconds of context", async ({
    page,
  }) => {
    const failures = monitorRuntime(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Evidence",
    );
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByText("No automated verdicts or actions"),
    ).toBeVisible();

    await page.getByRole("button", { name: /open review queue/i }).click();
    await expect(page).toHaveURL(/#cases$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /triage without shortcuts/i,
      }),
    ).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: "Player 04" });
    await expect(row).toContainText("highly anomalous");
    await row.click();
    await expect(page).toHaveURL(/#case\/case-echo$/);

    await expect(
      page.getByRole("heading", { level: 1, name: "Controlled player 04" }),
    ).toBeVisible();
    await expect(page.getByText("Strongest benign explanation")).toBeVisible();
    await expect(page.getByText("Known limitation")).toBeVisible();
    await expect(page.getByText(/tick 21,842/i).first()).toBeVisible();

    await page
      .getByRole("button", { name: /inspect 8-second context/i })
      .click();
    await expect(page).toHaveURL(
      /#demo\/controlled-demo-a\?tick=21842&case=case-echo$/,
    );
    await expect(page.getByRole("status")).toContainText(
      "Bounded API window · ticks 21,586–22,098",
    );
    await expect(page.getByRole("status")).toContainText(
      "whole telemetry artifact withheld",
    );
    await expect(page.getByText("tick 21,586")).toBeVisible();
    await expect(page.getByText("tick 22,098")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play playback" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Play playback" }).focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Pause playback" }),
    ).toBeVisible();
    await expectNoRuntimeFailures(failures);
  });

  test("compares independent demos and records a local review decision and note", async ({
    page,
  }) => {
    const failures = monitorRuntime(page);
    await page.goto("/#case/case-echo");

    const corroboration = page
      .getByRole("heading", { name: /across independent demos/i })
      .locator("..", {
        hasText: "Across independent demos",
      });
    await expect(page.getByText("influence capped per demo")).toBeVisible();
    await expect(page.getByText("0".repeat(64), { exact: true })).toBeVisible();
    await expect(page.getByText("2".repeat(64), { exact: true })).toBeVisible();
    await expect(corroboration).toBeVisible();
    const comparison = page.getByLabel("Cross-demo evidence comparison");
    await expect(comparison).toContainText("Primary evidence");
    await expect(comparison).toContainText("Cross-demo persistence");
    await expect(comparison).toContainText("invented partial telemetry");

    await page.getByLabel("Review status").selectOption("needs-context");
    await expect(page.getByLabel("Review status")).toHaveValue("needs-context");

    const note =
      "Confirm the audio cue before interpreting the occluded alignment.";
    await page.getByLabel("Add review note").fill(note);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText(note).last()).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Review status")).toHaveValue("needs-context");
    await expect(page.getByText(note).last()).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /export manifest/i }).click();
    const artifact = await download;
    expect(artifact.suggestedFilename()).toMatch(
      /^case-echo-[a-f0-9]{64}\.report\.json$/,
    );
    await expect(page.getByRole("status")).toContainText(
      "Verified report exported",
    );
    await expectNoRuntimeFailures(failures);
  });

  test("communicates insufficient data without manufacturing a score", async ({
    page,
  }) => {
    await page.goto("/#case/case-echo");
    await expect(
      page.getByRole("heading", { name: /not enough independent evidence/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/No review priority · insufficient data/i),
    ).toBeVisible();
  });
});
