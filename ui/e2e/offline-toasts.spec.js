import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

/**
 * Offline, moving round the app as the installed app does (no reloads):
 * no "Network Error" toasts. Each page shows the phone's saved copy, or its
 * own "needs a connection" note, and the offline bar says the rest. (A
 * reload offline needs the service worker: offline.spec.js, on a build.)
 */
test("offline: no error toasts anywhere", async ({ page, context }) => {
  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  await page.waitForTimeout(1500); // the trip saved on the phone
  const trip = new URL(page.url()).pathname.replace(/\/today$/, "");
  const errorToasts = page.getByTestId("toast-error");
  async function go(path) {
    await page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, trip + path);
    await page.waitForTimeout(1200);
  }

  await context.setOffline(true);
  for (const path of ["/today", "", "/days/2026-05-11", "/journal", "/map", "/weather", "/currency", "/time", "/packing", "/documents"]) {
    await go(path);
    await expect(errorToasts, `on ${path || "the timeline"}`).toHaveCount(0);
  }
  await expect(page.getByText("You’re offline. Documents need a connection.")).toBeVisible();

  // An entry's page draws mini maps, which used to ask for the Maps key.
  await go("/days/2026-05-11");
  await page.getByRole("link", { name: /Dinner at Kornhauskeller/ }).click();
  await expect(page.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(errorToasts).toHaveCount(0);

  // Coming back to the app reloads the trip (and fails, quietly).
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1500);
  await expect(errorToasts).toHaveCount(0);
  await page.screenshot({ path: screenshotPath("13a-offline-entry-no-toasts") });
});
