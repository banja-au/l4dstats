import { expect, test } from "@playwright/test";

test.describe("locale selection", () => {
  test.use({ locale: "es-ES" });

  test("uses browser preference, persists an explicit override, and keeps the toggle global", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByText("SUELTA LAS DEMOS")).toBeVisible();

    const toggle = page.getByRole("button", { name: "Idioma: English" });
    await expect(toggle).toContainText("ES");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("DROP DEMOS")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("l4dstats.locale")))
      .toBe("en");
    await expect
      .poll(
        async () =>
          (await context.cookies()).find(
            (cookie) => cookie.name === "l4dstats_locale",
          )?.value,
      )
      .toBe("en");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("DROP DEMOS")).toBeVisible();

    await page.goto("/analysis/not-a-real-analysis/quality");
    await expect(
      page.getByRole("button", { name: "Language: Español" }),
    ).toBeVisible();
  });
});
