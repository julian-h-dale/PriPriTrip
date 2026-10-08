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
