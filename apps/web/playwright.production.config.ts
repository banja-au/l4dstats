import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production-smoke.spec.ts",
  timeout: 12 * 60_000,
  expect: { timeout: 45_000 },
  workers: 1,
  use: {
    baseURL: "https://l4dstats.gg",
    ...devices["Desktop Chrome"],
    viewport: { width: 1_440, height: 1_000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
