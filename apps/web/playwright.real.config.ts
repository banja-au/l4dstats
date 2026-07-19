import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "l4dstats-real-e2e-"));
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

export default defineConfig({
  testDir: "./e2e",
  testMatch: "real-boundary.spec.ts",
  timeout: 12 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    ...devices["Desktop Chrome"],
    viewport: { width: 1_440, height: 1_000 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `exec env L4DSTATS_E2E_ROOT=${root} node scripts/run-real-boundary-stack.mjs`,
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
