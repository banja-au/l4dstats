import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { expect, test } from "@playwright/test";

test("analyzes a real demo through the production browser path", async ({
  page,
}) => {
  const demos = (
    process.env.L4DSTATS_PRODUCTION_DEMOS ??
    process.env.L4DSTATS_PRODUCTION_DEMO ??
    ""
  )
    .split(delimiter)
    .filter(Boolean);
  test.skip(
    demos.length === 0 || !demos.every(existsSync),
    "set L4DSTATS_PRODUCTION_DEMO or L4DSTATS_PRODUCTION_DEMOS",
  );
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await expect(page).toHaveTitle(/L4DStats/);
  await expect(page.getByRole("button", { name: /drop demos/i })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(demos);
  await expect(page.getByText("ANALYSIS COMPLETE")).toBeVisible({
    timeout: 10 * 60_000,
  });
  if (demos.length === 1) await expect(page).toHaveURL(/\/(?:analysis|game)\//);
  await expect(
    page.getByRole("navigation", { name: "Statistics sections" }),
  ).toBeVisible();
  await expect(page.locator(".upload-error")).toHaveCount(0);
  const analysisId = page.url().match(/\/analysis\/([^/]+)/)?.[1];
  if (analysisId) {
    const analysis = await page.evaluate(async (id) => {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      if (!response.ok)
        throw new Error(`job lookup returned ${response.status}`);
      return (await response.json()) as {
        analysis?: { sourceManifest?: { availability?: string } };
      };
    }, analysisId);
    expect(analysis.analysis?.sourceManifest?.availability).toBe(
      "deleted-after-extraction",
    );
  }
  expect(browserErrors).toEqual([]);
});

test.describe("production localization", () => {
  test.use({ locale: "es-ES" });

  test("serves Spanish from browser preference and persists an English override", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByText("SUELTA LAS DEMOS")).toBeVisible();
    await page.getByRole("button", { name: "EN ES" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("DROP DEMOS")).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("l4dstats.locale")),
    ).toBe("en");
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "l4dstats_locale",
      )?.value,
    ).toBe("en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "EN ES" })).toBeVisible();
  });
});
