import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";
const DINNER = "Dinner at Kornhauskeller";

// Two points of interest within half a mile of Kornhauskeller, one outside.
const POIS = [
  { name: "Zytglogge", category: "sight", location: { name: "Zytglogge", lat: 46.948, lng: 7.4479 } },
  { name: "Bundesplatz market", category: "market", location: { name: "Bundesplatz", lat: 46.9467, lng: 7.4442 } },
  { name: "Rosengarten viewpoint", category: "sight", location: { name: "Rosengarten", lat: 46.9537, lng: 7.4605 } },
];

/**
 * Nearby points of interest (Run stage 27): an activity's page lists the
 * trip's points of interest within half a mile, closest first; a row opens
 * the map at that pin. Dark and light at 375 px.
 */
// Both themes add to the same sample trip: one at a time.
test.describe.configure({ mode: "serial" });

for (const theme of ["dark", "light"]) {
  test(`nearby points of interest (${theme})`, async ({ page }) => {
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const headers = { Authorization: `Bearer ${token}` };
    const trips = await (await page.request.get(`${API_URL}/trips`, { headers })).json();
    const tripId = trips.find((t) => t.name === SAMPLE_TRIP).id;
    const getTrip = async () => (await page.request.get(`${API_URL}/trips/${tripId}`, { headers })).json();
    // This spec's points of interest, by name: cleared before (a stopped run
    // leaves them) and after.
    const clear = async () => {
      for (const poi of (await getTrip()).pointsOfInterest ?? []) {
        if (!POIS.some((p) => p.name === poi.name)) continue;
        await page.request.delete(`${API_URL}/trips/${tripId}/points-of-interest/${poi.id}`, {
          headers: { ...headers, "If-Match": `"${poi.version}"` },
        });
      }
    };
    await clear();
    const dinner = (await getTrip()).days.flatMap((d) => d.items).find((i) => i.title === DINNER);

    try {
      for (const poi of POIS) {
        await page.request.post(`${API_URL}/trips/${tripId}/points-of-interest`, { headers, data: poi });
      }

      await page.goto(`/trips/${tripId}/activities/${dinner.id}`);
      const nearby = page.getByRole("region", { name: "Nearby" });
      await expect(nearby).toBeVisible();
      await expect(nearby.getByRole("link")).toHaveText([/^Zytglogge/, /^Bundesplatz market/]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      await nearby.scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshotPath(`27a-nearby-${theme}`) });

      await nearby.getByRole("link", { name: /Bundesplatz market/ }).click();
      await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/map$`));
      await expect(page.locator(".gm-style-iw").getByText("Bundesplatz market")).toBeVisible();
      await page.screenshot({ path: screenshotPath(`27b-nearby-map-${theme}`) });
    } finally {
      await clear();
    }
  });
}
