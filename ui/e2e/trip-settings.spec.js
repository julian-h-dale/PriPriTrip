import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";
const RENAMED = "Bern & Wengen (renamed)";

/**
 * Trip settings (Run stage 29, Phases 102–103): from the trips list's ⋯,
 * rename the trip, give it an emoji cover and make it open on the map; the
 * card shows the name and cover, and opens the map. Put back after.
 * Dark and light at 375 px.
 */
test.describe.configure({ mode: "serial" });

for (const theme of ["dark", "light"]) {
  test(`trip settings (${theme})`, async ({ page }) => {
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const headers = { Authorization: `Bearer ${token}` };
    const trips = await (await page.request.get(`${API_URL}/trips`, { headers })).json();
    const tripId = trips.find((t) => t.name === SAMPLE_TRIP || t.name === RENAMED).id;
    const restore = () =>
      page.request.patch(`${API_URL}/trips/${tripId}`, {
        headers,
        data: { name: SAMPLE_TRIP, coverEmoji: null, coverPhotoId: null },
      });
    await restore();

    try {
      // The sample trip is in May: under Past, folded away.
      const openPast = async () => {
        await expect(page.getByRole("button", { name: /^Past \(/ })).toBeVisible();
        if ((await page.getByRole("button", { name: /^Past \(/ }).getAttribute("aria-expanded")) === "false") {
          await page.getByRole("button", { name: /^Past \(/ }).click();
        }
      };
      await page.goto("/trips");
      await openPast();
      await page.getByRole("button", { name: `More for ${SAMPLE_TRIP}` }).click();
      await page.getByRole("menuitem", { name: "Trip settings" }).click();
      await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/settings$`));
      await expect(page.getByRole("region", { name: "People" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      await page.screenshot({ path: screenshotPath(`29c-trip-settings-${theme}`), fullPage: true });

      // On this phone: open the trip on its map from now on.
      const phone = page.getByRole("region", { name: "On this phone" });
      await phone.getByRole("radiogroup", { name: "Opens on" }).getByRole("radio", { name: "Map" }).click();

      await page.getByRole("button", { name: "Use 🏔️" }).click();
      await expect(page.getByRole("button", { name: "Use 🏔️" })).toHaveAttribute("aria-pressed", "true");
      const name = page.getByLabel("Trip name");
      await name.fill(RENAMED);
      await page.getByRole("region", { name: "Name" }).getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("region", { name: "Name" }).getByRole("button", { name: "Save" })).toBeDisabled();

      await page.getByRole("button", { name: "Back" }).click();
      await openPast();
      const card = page.getByRole("link", { name: new RegExp(RENAMED.replace(/[()]/g, "\\$&")) });
      await expect(card).toBeVisible();
      await expect(card).toContainText("🏔️");
      await page.screenshot({ path: screenshotPath(`29d-trip-card-cover-${theme}`) });

      // Opening the trip from its card now goes to the map.
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/map$`));
    } finally {
      await restore();
    }
  });
}
