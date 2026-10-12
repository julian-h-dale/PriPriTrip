import { test, expect } from "@playwright/test";
import { login, screenshotPath } from "./helpers.js";

/**
 * Tapping one of Google's own places on the map (Run stage 28) opens our
 * card, "Not in this trip" with the Add actions, never Google's popup.
 *
 * Google decides where its place icons are drawn, so the spec takes the
 * first trip's map to Bern's old town through the map's Google search (any
 * trip will do: nothing is saved), then taps a grid of points until one
 * lands on a Google place. Dark and light at 375 px. A viewer's card (no Add
 * actions) is covered by the jsdom tests.
 */

/** Taps the map in a grid until our "Not in this trip" card opens; true if it did. */
async function tapUntilGooglePlace(page) {
  const box = await page.locator(".gm-style").first().boundingBox();
  const card = page.locator(".gm-style-iw").getByText("Not in this trip");
  // Below the search bar and filters, above the bottom nav and List button.
  for (let y = box.y + 200; y < box.y + box.height - 120; y += 28) {
    for (let x = box.x + 24; x < box.x + box.width - 24; x += 28) {
      await page.mouse.click(x, y);
      try {
        await card.waitFor({ timeout: 600 });
        return true;
      } catch {
        // Not a Google place (or one of the trip's pins): try the next point.
      }
      // Google's own popup never opens, whatever was tapped.
      await expect(page.locator(".poi-info-window")).toHaveCount(0);
    }
  }
  return false;
}

/** The first trip's map at street zoom on Bern's old town, nothing open. */
async function openMapInBern(page) {
  const href = await page.getByRole("link").filter({ hasText: /nights?/ }).first().getAttribute("href");
  const tripId = href.match(/\/trips\/([^/?#]+)/)[1];
  await page.goto(`/trips/${tripId}/map`);
  const search = page.getByRole("combobox", { name: "Search trip or places" });
  await search.fill("Zytglogge Bern");
  const list = page.getByRole("listbox", { name: "Matching places" });
  await list.getByRole("option", { name: /Zytglogge/ }).first().getByRole("button").click();
  await expect(page.locator(".gm-style-iw").getByText("Zytglogge").first()).toBeVisible();
  // Drop the search result (its white pin would open the same card).
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".gm-style-iw")).toHaveCount(0);
  await page.waitForTimeout(1000); // tiles and place icons settle
}

for (const theme of ["dark", "light"]) {
  test(`tapping a Google place opens our card (${theme})`, async ({ page }) => {
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await login(page);
    await openMapInBern(page);

    expect(await tapUntilGooglePlace(page)).toBe(true);
    await expect(page.locator(".poi-info-window")).toHaveCount(0);
    const card = page.locator(".gm-style-iw");
    await expect(card.getByRole("button", { name: /Add activity|Point of interest|Add stay/ }).first()).toBeVisible();
    await expect(card.getByRole("link", { name: "Google Maps" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: screenshotPath(`28a-map-tap-${theme}`) });

    // Point of interest opens the form with the tapped place; Cancel saves nothing.
    await card.getByRole("button", { name: /Point of interest|More…/ }).first().click();
    if (await card.getByRole("button", { name: "Point of interest" }).isVisible()) {
      await card.getByRole("button", { name: "Point of interest" }).click();
    }
    const dialog = page.getByRole("dialog", { name: "Add point of interest" });
    await expect(dialog.getByLabel("Name")).not.toHaveValue("");
    await page.screenshot({ path: screenshotPath(`28b-map-tap-poi-form-${theme}`) });
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
}
