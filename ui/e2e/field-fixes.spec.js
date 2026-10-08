import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

/**
 * Run stage 21's field fixes. The demo trip ("Athens Getaway") is built
 * around the day `make seed` runs: day 3 of 8, staying since day 2. Re-seed
 * on the day you run this.
 */
test("a trip opens on Today; Tonight says when to check out", async ({ page }) => {
  await login(page);
  await (await tripLink(page, "Athens Getaway")).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}\/today$/);
  const tonight = page.getByRole("region", { name: "Tonight" });
  await expect(tonight.getByText(/^Check-out /)).toBeVisible();
  await expect(tonight.getByText(/^Check-in /)).toHaveCount(0);
  await page.screenshot({ path: screenshotPath("21a-today-tonight-checkout"), fullPage: true });

  // A past trip opens on its timeline.
  await page.goto("/trips");
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
});

test("on a touch phone, a tool's Back button doesn't come up filled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await login(page);
  await (await tripLink(page, "Athens Getaway")).click();
  await page.getByRole("button", { name: "Open menu" }).tap();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Currency" }).tap();
  const back = page.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();
  // What a phone does after a tap: the spot stays "hovered". (A Playwright
  // tap doesn't, so put the pointer there; the phone has no real hover.)
  await back.hover();
  await page.waitForTimeout(300);
  expect(await back.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: screenshotPath("21b-tool-back-button") });
  await context.close();
});

test("search results say when and where", async ({ page }) => {
  await login(page);
  await (await tripLink(page, "Athens Getaway")).click();
  await page.getByRole("button", { name: "Search this trip" }).click();
  await page.getByRole("searchbox", { name: "Search this trip" }).fill("dinner");
  await expect(page.getByRole("dialog").getByRole("link").first()).toContainText(/\d:\d\d [AP]M/);
  await page.screenshot({ path: screenshotPath("21c-search-details") });
});
