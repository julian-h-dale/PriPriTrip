import { defineConfig } from "@playwright/test";

/**
 * Practical, screenshot-first E2E checks: page views and basic clicking, no
 * visual-diff baselines. The UI is still changing a lot, so these stay light
 * on purpose — see ui/e2e/README.md.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    // A phone-width viewport, matching the project's mobile-first convention
    // (no WebKit/device-preset dependency — just Chromium at phone width).
    viewport: { width: 375, height: 812 },
  },
  webServer: [
    {
      command: "make dev-api",
      cwd: "..",
      url: "http://localhost:8000/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "make dev-ui",
      cwd: "..",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
