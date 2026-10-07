import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

/**
 * "Use saved copies only" (Run stage 20): with it on, moving through every
 * page sends nothing to the API, Google or Umami: no request to anywhere but
 * the dev UI server itself (the app's own code, which an installed app has
 * already). The API's address varies (ui/.env may point at a LAN address),
 * so anything off the UI's origin counts.
 */
test("saved copies only: nothing leaves the phone", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const outside = [];
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith(baseURL) || /^(data|blob):/.test(url)) return;
    outside.push(`${r.method()} ${url}`);
  });

  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  await page.waitForTimeout(1500);
  const trip = new URL(page.url()).pathname.replace(/\/today$/, "");

  await page.getByRole("button", { name: "Open menu" }).click();
  expect(outside.length).toBeGreaterThan(0); // the API was being called (so the check below means something)
  await page.getByRole("switch", { name: "Use saved copies only" }).click();
  await expect(page.getByRole("switch", { name: "Use saved copies only" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: screenshotPath("20a-saved-only-drawer") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  outside.length = 0; // from here on, nothing may go out

  async function go(path) {
    await page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, trip + path);
    await page.waitForTimeout(1000);
  }
  for (const path of ["", "/today", "/days/2026-05-11", "/journal", "/map", "/weather", "/currency", "/time", "/packing", "/documents"]) {
    await go(path);
  }
  await go("/days/2026-05-11");
  await page.getByRole("link", { name: /Dinner at Kornhauskeller/ }).click();
  await expect(page.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath("20b-saved-only-entry") });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1000);
  expect(outside).toEqual([]);
  await expect(page.getByText(/^Saved copies only · saved copy from/)).toBeVisible();

  // Remembered across a reload (only /users/me may go, to know who you are).
  await page.reload();
  await page.waitForTimeout(2000);
  expect(outside.filter((r) => !r.endsWith("/users/me"))).toEqual([]);
  await page.screenshot({ path: screenshotPath("20c-saved-only-after-reload") });

  // Off again: the trip reloads.
  await go("");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("switch", { name: "Use saved copies only" }).click();
  await expect.poll(() => outside.some((r) => r.includes("/trips/"))).toBe(true);
});
