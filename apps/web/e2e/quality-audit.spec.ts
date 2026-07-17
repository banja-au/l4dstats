import { expect, test, type Page } from "@playwright/test";

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.scroll,
    `document width ${dimensions.scroll}px exceeds viewport ${dimensions.client}px`,
  ).toBeLessThanOrEqual(dimensions.client + 1);
}

test.describe("responsive and accessible quality audit", () => {
  for (const route of ["/", "/#cases", "/#case/case-echo", "/#demo/demo-a"]) {
    test(`has no page-level overflow or unnamed controls at ${route}`, async ({
      page,
    }, testInfo) => {
      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(error.message));
      page.on(
        "console",
        (message) =>
          message.type() === "error" && failures.push(message.text()),
      );

      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      await expectNoDocumentOverflow(page);

      const unnamed = await page
        .locator("button, a, input, select, textarea")
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const name = [
                element.getAttribute("aria-label"),
                element.getAttribute("aria-labelledby"),
                element.getAttribute("title"),
                Array.from((element as HTMLInputElement).labels ?? [])
                  .map((label) => label.textContent)
                  .join(" "),
                element.textContent,
              ]
                .filter(Boolean)
                .join(" ");
              return !name?.trim();
            })
            .map((element) => element.outerHTML.slice(0, 180)),
        );
      expect(
        unnamed,
        `unnamed interactive elements:\n${unnamed.join("\n")}`,
      ).toEqual([]);
      expect(failures, failures.join("\n")).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath("audit.png"),
        fullPage: true,
      });
      if (route === "/" && testInfo.project.name === "desktop-chromium") {
        await page.screenshot({
          path: "../../docs/assets/workbench-overview.jpg",
          type: "jpeg",
          quality: 82,
          fullPage: true,
        });
      }
    });
  }

  test("skip navigation and keyboard focus reach the workspace", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to workspace" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#workspace$/);
    await expect(page.locator("#workspace")).toBeFocused();

    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"]).toContain(focused);
  });

  test("case queue rows expose a keyboard-operable case action", async ({
    page,
  }) => {
    await page.goto("/#cases");
    const row = page.getByRole("row").filter({ hasText: "Player 04" });
    const action = row.locator("a, button, [role=link], [role=button]").first();
    await expect(action).toBeVisible();
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#case\/case-echo$/);
  });

  test("reduced motion disables decorative and tactical animation", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const animated = await page.locator("*").evaluateAll((elements) =>
      elements
        .map((element) => ({
          className:
            typeof element.className === "string"
              ? element.className
              : (element.getAttribute("class") ?? ""),
          animation: getComputedStyle(element).animationName,
        }))
        .filter(({ animation }) => animation !== "none")
        .slice(0, 20),
    );
    expect(animated, JSON.stringify(animated, null, 2)).toEqual([]);
  });

  test("ingest dialog is legible, bounded, and keyboard dismissible", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Ingest demo" }).click();
    const dialog = page.getByRole("dialog", { name: /add a demo/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Container path")).toBeFocused();
    await expectNoDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("ingest-dialog.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("mobile navigation opens, changes route, and closes without obscuring content", async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "mobile-chromium",
      "mobile-only interaction",
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("navigation", { name: /workbench|primary navigation/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cases", exact: true }).click();
    await expect(page).toHaveURL(/#cases$/);
    await expect(
      page.getByRole("heading", { name: /triage without shortcuts/i }),
    ).toBeVisible();
    await expectNoDocumentOverflow(page);
  });

  test("mobile case queue does not require horizontal scrolling to triage", async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "mobile-chromium",
      "mobile-only layout gate",
    );
    await page.goto("/#cases");
    const tableViewport = page.locator(".table-wrap");
    const widths = await tableViewport.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(
      widths.scroll,
      `case queue width ${widths.scroll}px exceeds its ${widths.client}px mobile viewport`,
    ).toBeLessThanOrEqual(widths.client + 1);
  });
});
