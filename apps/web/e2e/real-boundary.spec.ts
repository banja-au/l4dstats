import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const demos = [
  "/workspace/data/sprint-4-e2e-corpus/915419_c2m3_coaster/915419_c2m3_coaster.dem",
  "/workspace/data/sprint-4-e2e-corpus/915419_c2m4_barns/915419_c2m4_barns.dem",
] as const;

async function ingest(page: Page, path: string) {
  await page.getByRole("button", { name: "Ingest demo" }).click();
  await page.getByLabel("Container path").fill(path);
  await page.getByRole("button", { name: /validate & queue/i }).click();
  await expect(page.getByRole("status")).toContainText("succeeded", {
    timeout: 8 * 60_000,
  });
  await page
    .getByRole("button", { name: "Close ingest dialog" })
    .last()
    .click();
}

test("reviews a real corpus case through the API, worker, and storage boundary", async ({
  page,
  request,
}) => {
  test.skip(
    !demos.every(existsSync),
    "ignored real same-player corpus is unavailable",
  );
  await page.goto("/");
  await ingest(page, demos[0]);
  await ingest(page, demos[1]);

  const summaries = (await (
    await request.get("/api/cases?limit=100&offset=0")
  ).json()) as {
    items: Array<{ id: string }>;
  };
  const details = await Promise.all(
    summaries.items.map(
      async ({ id }) =>
        (await (
          await request.get(`/api/cases/${encodeURIComponent(id)}`)
        ).json()) as {
          id: string;
          presentation: {
            demos: Array<{ id: string; sha256: string }>;
            evidence: Array<{
              id: string;
              title: string;
              demoSha256: string;
              tick: number;
            }>;
            association: { corroboratingDemoCount: number };
          };
        },
    ),
  );
  const production = details.find(
    (detail) =>
      detail.presentation.demos.length === 2 &&
      detail.presentation.association.corroboratingDemoCount === 1 &&
      detail.presentation.evidence.length > 0,
  );
  expect(
    production,
    "real same-player corpus pair must produce a merged evidence case",
  ).toBeTruthy();

  await page.goto(`/?real-case=1#case/${production!.id}`);
  await expect(page.getByLabel("Cross-demo evidence comparison")).toBeVisible();
  for (const associatedDemo of production!.presentation.demos)
    await expect(
      page.getByText(associatedDemo.sha256, { exact: true }).first(),
    ).toBeVisible();
  const sourceDemo = production!.presentation.demos.find((candidate) =>
    production!.presentation.evidence.some(
      (event) => event.demoSha256 === candidate.sha256,
    ),
  )!;
  const sourceEvidence = production!.presentation.evidence.find(
    (event) => event.demoSha256 === sourceDemo.sha256,
  );
  if (sourceEvidence) {
    await page
      .getByRole("button", { name: new RegExp(sourceEvidence.title, "i") })
      .click();
    await page.getByRole("button", { name: /inspect .* context/i }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `#demo/${sourceDemo.id}\\?tick=${sourceEvidence.tick}&case=${production!.id}$`,
      ),
    );
    await expect(page.getByRole("status")).toContainText(
      `demo ${sourceDemo.sha256}`,
    );
  } else {
    const comparison = page.getByLabel("Cross-demo evidence comparison");
    await expect(comparison).toContainText("no bounded windows");
  }
  const noEvidenceDemo = production!.presentation.demos.find(
    (candidate) =>
      !production!.presentation.evidence.some(
        (event) => event.demoSha256 === candidate.sha256,
      ),
  );
  expect(
    noEvidenceDemo,
    "corroborating demo must preserve explicit no-evidence context",
  ).toBeTruthy();
  await page.goto(`/?real-case-return=1#case/${production!.id}`);
  await expect(page.getByLabel("Cross-demo evidence comparison")).toContainText(
    "no bounded windows",
  );

  await page.goto(`/?real-review=1#case/${production!.id}`);
  await page.getByLabel("Review status").selectOption("needs-context");
  const note =
    "Real-boundary review: second demo has no bounded evidence window.";
  await page.getByLabel("Add review note").fill(note);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(note)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /export manifest/i }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toMatch(
    new RegExp(`^${production!.id}-[a-f0-9]{64}\\.report\\.json$`),
  );
  const artifactPath = await artifact.path();
  expect(artifactPath).not.toBeNull();
  const reportText = await readFile(artifactPath!, "utf8");
  const reportSha256 = createHash("sha256").update(reportText).digest("hex");
  expect(artifact.suggestedFilename()).toContain(reportSha256);
  expect(reportText).not.toMatch(/STEAM_|\[U:|7656119/);
  const report = JSON.parse(reportText) as {
    presentation: { demos: Array<{ sha256: string }> };
    lineage: { sources: unknown[] };
  };
  expect(report.presentation.demos).toHaveLength(2);
  expect(report.lineage.sources).toHaveLength(2);
});
