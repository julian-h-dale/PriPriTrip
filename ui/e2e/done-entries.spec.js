import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

/**
 * What's happened fades (Run stage 30, Phase 104): the sample trip's
 * May 11 at 11:30 in Zurich. The landing and the airport train are faded;
 * lunch at 12:15 and the rest of the day aren't. Dark and light at 375 px.
 */
for (const theme of ["dark", "light"]) {
  test(`done entries fade (${theme})`, async ({ page }) => {
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const trips = await (
      await page.request.get(`${API_URL}/trips`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    const tripId = trips.find((t) => t.name === SAMPLE_TRIP).id;

    await page.clock.setFixedTime(new Date("2026-05-11T09:30:00Z"));
    await page.goto(`/trips/${tripId}/days/2026-05-11`);
    const list = page.getByRole("list", { name: /^Plans for/ });
    await expect(list.getByRole("listitem").first()).toBeVisible();
    const done = await list.getByRole("listitem").evaluateAll((lis) => lis.map((li) => li.dataset.done === "true"));
    expect(done).toEqual([true, true, false, false, false, false]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: screenshotPath(`30a-done-entries-${theme}`) });
  });
}
