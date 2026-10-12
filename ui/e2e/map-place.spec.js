import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

/**
 * The map keeps its place (Run stage 29, Phase 100b): filter to Stays and
 * drag the map, go to the timeline and back, and the map is where it was:
 * the same filter, and a hotel's pin on the same spot of the screen.
 */
test("the map keeps its place", async ({ page }) => {
  await login(page);
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const headers = { Authorization: `Bearer ${token}` };
  const trips = await (await page.request.get(`${API_URL}/trips`, { headers })).json();
  const tripId = trips.find((t) => t.name === SAMPLE_TRIP).id;
  const trip = await (await page.request.get(`${API_URL}/trips/${tripId}`, { headers })).json();
  const hotel = trip.stays[0].name;

  await page.goto(`/trips/${tripId}/map`);
  await page.getByRole("button", { name: /^Filter the map/ }).click();
  await page.getByRole("menuitemradio", { name: "Stays" }).click();
  const pin = page.locator(`gmp-advanced-marker[title="${hotel}"]`).first();
  await expect(pin).toBeAttached();
  await page.waitForTimeout(1000); // the fit to the stays settles

  // Drag the map a little up and left.
  const map = await page.locator(".gm-style").first().boundingBox();
  const x = map.x + map.width / 2;
  const y = map.y + map.height / 2 + 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y - 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const before = await pin.boundingBox();

  const nav = page.getByRole("navigation", { name: "Trip" });
  await nav.getByRole("link", { name: "Timeline" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));
  await nav.getByRole("link", { name: "Map" }).click();

  await expect(page.getByRole("button", { name: "Filter the map: Stays" })).toBeVisible();
  await expect(pin).toBeAttached();
  await page.waitForTimeout(1000); // nothing should move now
  const after = await pin.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThan(3);
  expect(Math.abs(after.y - before.y)).toBeLessThan(3);
  await page.screenshot({ path: screenshotPath("29b-map-kept") });
});
