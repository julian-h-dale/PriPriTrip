import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

/**
 * The timeline keeps its place (Run stage 29, Phase 100): Stays, scrolled
 * down, then the Map tab and back to the Timeline tab, is still Stays at the
 * same spot. Tapping Timeline while on it goes back to the top of the plan.
 * A short phone, so the sample trip's five days scroll.
 */
test.use({ viewport: { width: 375, height: 520 } });

for (const theme of ["dark", "light"]) {
  test(`the timeline keeps its place (${theme})`, async ({ page }) => {
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const trips = await (
      await page.request.get(`${API_URL}/trips`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    const tripId = trips.find((t) => t.name === SAMPLE_TRIP).id;

    await page.goto(`/trips/${tripId}`);
    await page.getByRole("button", { name: "Stays" }).click();
    const root = page.locator("[data-scroll-root]");
    const top = await root.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(top).toBeGreaterThan(0);
    // Let the scroll event land before leaving.
    await page.waitForTimeout(100);

    const nav = page.getByRole("navigation", { name: "Trip" });
    await nav.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/map$`));
    await nav.getByRole("link", { name: "Timeline" }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));

    await expect(page.getByRole("button", { name: "Stays" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => root.evaluate((el) => el.scrollTop)).toBe(top);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: screenshotPath(`29a-timeline-kept-${theme}`) });

    // Timeline, tapped while on it: the top of the plan.
    await nav.getByRole("link", { name: "Timeline" }).click();
    await expect(page.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => root.evaluate((el) => el.scrollTop)).toBe(0);
  });
}
