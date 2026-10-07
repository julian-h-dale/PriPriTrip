import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { filterMap, login, screenshotPath, tripLink } from "./helpers.js";

// Standing a few metres from the Bern hotel (the sample trip's first stay).
const NEAR_HOTEL = { latitude: 46.9488, longitude: 7.4487, accuracy: 15 };
test.use({ geolocation: NEAR_HOTEL, permissions: ["geolocation"] });

test("location: a memory names the place it was written near, pins on the map, and the blue dot shows", async ({ page }) => {
  const text = `Located memory ${Date.now()}`;
  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  const tripId = new URL(page.url()).pathname.split("/")[2];
  const nav = page.getByRole("navigation", { name: "Trip" });
  await nav.getByRole("link", { name: "Journal" }).click();

  await page.getByRole("button", { name: "New memory" }).click();
  const dialog = page.getByRole("dialog", { name: "New memory" });
  await expect(dialog.getByText(/^Near Hotel/)).toBeVisible(); // already allowed: located on open
  await dialog.getByLabel("What happened?").fill(text);
  await page.screenshot({ path: screenshotPath("26-memory-location"), fullPage: true });
  await dialog.getByRole("button", { name: "Save" }).click();
  const card = page.getByRole("listitem").filter({ hasText: text });
  await expect(card.getByRole("link", { name: /^Near Hotel/ })).toBeVisible();
  await expect(card).not.toContainText("Waiting to sync");

  await nav.getByRole("link", { name: "Map" }).click();
  // Memories show only with the Journal filter on: then the memory's own
  // pin, and the blue "you are here" dot.
  await filterMap(page, "Journal");
  await expect(page.locator(`gmp-advanced-marker[title^='${text}']`)).toHaveCount(1);
  await expect(page.locator("gmp-advanced-marker[title='You are here']")).toHaveCount(1);
  await page.getByRole("button", { name: "Show where I am" }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: screenshotPath("27-map-blue-dot"), fullPage: true });

  // Clean up.
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await (await page.request.get(`${API_URL}/trips/${tripId}/memories`, { headers })).json();
  for (const m of saved.filter((x) => x.text === text)) {
    await page.request.delete(`${API_URL}/trips/${tripId}/memories/${m.id}`, { headers });
  }
});
