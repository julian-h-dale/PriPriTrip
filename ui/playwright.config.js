import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// This checkout's own ports (a worktree's differ — scripts/new-worktree.sh),
// read the same way vite.config.js and api/dev.sh do.
const here = path.dirname(fileURLToPath(import.meta.url));
function envValue(file, key, fallback) {
  try {
    const match = fs.readFileSync(path.join(here, file), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return match ? match[1].trim() : fallback;
  } catch {
    return fallback;
  }
}
const UI_PORT = envValue(".env", "VITE_UI_PORT", "3000");
const API_PORT = envValue("../api/.env", "API_PORT", "8000");
export const API_URL = `http://localhost:${API_PORT}`;

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
    baseURL: `http://localhost:${UI_PORT}`,
    browserName: "chromium",
    // A phone-width viewport, matching the project's mobile-first convention
    // (no WebKit/device-preset dependency — just Chromium at phone width).
    viewport: { width: 375, height: 812 },
  },
  webServer: [
    {
      command: "make dev-api",
      cwd: "..",
      url: `${API_URL}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "make dev-ui",
      cwd: "..",
      url: `http://localhost:${UI_PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
