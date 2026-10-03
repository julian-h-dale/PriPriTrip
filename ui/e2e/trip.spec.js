import { test, expect } from "@playwright/test";
import { login, screenshotPath } from "./helpers.js";

/**
 * Practical smoke checks: page views and basic clicking against the seeded
 * sample trip (stable via `make seed`), each ending in a named screenshot so
 * they can be reviewed without being at a screen. No visual-diff baselines —
 * the UI is still changing a lot.
 */
const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

// One at a time: the add-from-map test briefly adds markers to the sample
// trip, which the other map tests count.
test.describe.configure({ mode: "serial" });

test("trips list", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("link", { name: SAMPLE_TRIP })).toBeVisible();
  await page.screenshot({ path: screenshotPath("01-trips-list"), fullPage: true });
});

test("trip timeline", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: SAMPLE_TRIP }).click();
  await expect(page.getByRole("heading", { name: SAMPLE_TRIP, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Trip days" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("02-trip-timeline"), fullPage: true });
});

test("day detail page", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: SAMPLE_TRIP }).click();
  await page.getByRole("list", { name: "Trip days" }).getByRole("listitem").first().getByRole("link").click();
  await expect(page.getByRole("list", { name: /^Plans for/ })).toBeVisible();
  await page.screenshot({ path: screenshotPath("03-day-detail"), fullPage: true });

  // Expand the first entry to show its details, including the mini-map preview.
  await page.getByRole("list", { name: /^Plans for/ }).getByRole("button").first().click();
  await page.waitForTimeout(1000); // let the mini-map tile load
  await page.screenshot({ path: screenshotPath("04-day-detail-entry-expanded"), fullPage: true });
});

test("stays and travel coverage views", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: SAMPLE_TRIP }).click();
  await expect(page.getByRole("heading", { name: SAMPLE_TRIP, level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Show which nights have a stay" }).click();
  await page.screenshot({ path: screenshotPath("05-stays-view"), fullPage: true });

  // A covered night opens a quick read-only look first, not the edit form.
  await page.locator("#day-2026-05-11").getByRole("button").click();
  const details = page.getByRole("dialog", { name: "Hotel Goldener Schlüssel" });
  await expect(details).toBeVisible();
  await page.waitForTimeout(1000); // let the mini-map tile load
  await page.screenshot({ path: screenshotPath("05a-stays-view-details"), fullPage: true });

  await details.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("dialog", { name: "Edit stay" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("05a1-stays-view-edit-stay"), fullPage: true });
  await page.keyboard.press("Escape");

  // An uncovered night opens the add form instead.
  await page.locator("#day-2026-05-10").getByRole("button").click();
  await expect(page.getByRole("dialog", { name: "Add stay" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("05b-stays-view-add-stay"), fullPage: true });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Show which days have travel" }).click();
  await page.screenshot({ path: screenshotPath("06-travel-view"), fullPage: true });
});

test("bottom nav and map page", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: SAMPLE_TRIP }).click();
  const nav = page.getByRole("navigation", { name: "Trip" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Timeline" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "Map" }).click();
  await expect(nav.getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");

  // Every located stay/travel-endpoint/activity in the sample trip (2 stays,
  // 4 located travel endpoints, 4 located activities).
  const pins = page.locator("gmp-advanced-marker");
  await expect(pins).toHaveCount(10);
  await page.screenshot({ path: screenshotPath("07-map"), fullPage: true });

  // Clicking one opens an info window with its title, day, and both links.
  await pins.first().click({ force: true });
  const infoWindow = page.locator(".gm-style-iw");
  await expect(infoWindow.getByRole("link", { name: "View day" })).toBeVisible();
  await expect(infoWindow.getByRole("link", { name: "Directions" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("07a-map-info-window"), fullPage: true });
});

test("map search and filters", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: SAMPLE_TRIP }).click();
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Map" }).click();
  const pins = page.locator("gmp-advanced-marker");
  await expect(pins).toHaveCount(10);

  // Search matches the trip's own markers first; picking one pans + opens it.
  await page.getByRole("combobox", { name: "Search trip or places" }).fill("Kornhaus");
  const suggestion = page.getByRole("option", { name: /Kornhauskeller/ });
  await expect(suggestion).toBeVisible();
  await page.screenshot({ path: screenshotPath("08-map-search-suggestions"), fullPage: true });
  await suggestion.click();
  await expect(page.locator(".gm-style-iw")).toContainText("Dinner at Kornhauskeller");

  // House filter: only the sample trip's 2 stays.
  await page.getByRole("button", { name: "Show only stays" }).click();
  await expect(pins).toHaveCount(2);
  // Round-tripping the filter off shouldn't lose any markers (regression:
  // Google Maps silently dropped one of two co-located markers — e.g.
  // Chicago appearing on both the outbound and return flight — when
  // detaching/reattaching instead of rebuilding them).
  await page.getByRole("button", { name: "Show only stays" }).click();
  await expect(pins).toHaveCount(10);

  // Calendar filter: one day, combined with House.
  await page.getByRole("button", { name: "Show one day" }).click();
  await page.getByRole("textbox", { name: "Pick a day" }).fill("2026-05-12");
  await expect(page.getByRole("button", { name: /Showing Tue, May 12/ })).toBeVisible();
  await page.screenshot({ path: screenshotPath("09-map-date-filter"), fullPage: true });
  await page.getByRole("button", { name: "Show only stays" }).click();
  await expect(pins).toHaveCount(1); // Beausite Park Hotel covers that night
});

/** Delete what a test added through the UI, so the dev trip is left as it was. */
async function deleteAdded(page, tripId, { itemTitle, stayName }) {
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const api = "http://localhost:8000";
  const headers = { Authorization: `Bearer ${token}` };
  const trip = await (await page.request.get(`${api}/trips/${tripId}`, { headers })).json();
  for (const day of trip.days) {
    for (const item of day.items.filter((i) => i.title === itemTitle)) {
      await page.request.delete(`${api}/trips/${tripId}/items/${item.id}`, { headers });
    }
  }
  for (const stay of trip.stays.filter((s) => s.name === stayName)) {
    await page.request.delete(`${api}/trips/${tripId}/stays/${stay.id}`, { headers });
  }
}

test("map: add a Google place to the trip (activity and stay)", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: SAMPLE_TRIP }).click();
  const tripId = page.url().split("/trips/")[1];
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Map" }).click();
  const pins = page.locator("gmp-advanced-marker");
  await expect(pins).toHaveCount(10);
  const search = page.getByRole("combobox", { name: "Search trip or places" });
  let addedItem = null;
  let addedStay = null;

  try {
    // A café that isn't on the trip: Google rows, marked New, under the trip's own.
    await search.fill("Café Fédéral Bern");
    const cafe = page.getByRole("option", { name: /Café Fédéral/ }).first();
    await expect(cafe).toBeVisible();
    await expect(page.getByText("New places")).toBeVisible();
    await page.screenshot({ path: screenshotPath("14-map-search-new-places"), fullPage: true });
    await cafe.click();

    const info = page.locator(".gm-style-iw");
    await expect(info).toContainText("Not in this trip");
    await expect(pins).toHaveCount(11); // + the search-result marker
    await expect(info.getByRole("button", { name: "Add activity" })).toBeVisible();
    await expect(info.getByRole("button", { name: "Add stay" })).toHaveCount(0); // not lodging
    // The window opens below the search bar, not behind it.
    const bar = await search.boundingBox();
    const windowBox = await info.boundingBox();
    expect(windowBox.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    await page.waitForTimeout(1000); // let tiles and the photo load for the screenshot
    await page.screenshot({ path: screenshotPath("15-map-new-place-info"), fullPage: true });

    await info.getByRole("button", { name: "Add activity" }).click();
    const activity = page.getByRole("dialog", { name: "Add activity" });
    await expect(activity.getByLabel("Title")).toHaveValue(/Café Fédéral/);
    addedItem = await activity.getByLabel("Title").inputValue();
    await page.screenshot({ path: screenshotPath("16-map-add-activity-prefilled"), fullPage: true });
    await activity.getByRole("button", { name: "Save" }).click();
    await expect(activity).toBeHidden();
    // Saved: a real trip marker now, and the temporary one is gone.
    await expect(pins).toHaveCount(11);
    await expect(search).toHaveValue("");

    // A hotel: lodging, so Add stay comes first.
    await search.fill("Hotel Bellevue Palace Bern");
    await page.getByRole("option", { name: /Bellevue Palace/ }).first().click();
    await expect(info).toContainText("Not in this trip");
    await info.getByRole("button", { name: "Add stay" }).click();
    const stay = page.getByRole("dialog", { name: "Add stay" });
    addedStay = await stay.getByLabel("Name").inputValue();
    expect(addedStay).toMatch(/Bellevue Palace/);
    await stay.getByRole("button", { name: "Save" }).click();
    await expect(stay).toBeHidden();
    await expect(pins).toHaveCount(12);
  } finally {
    await deleteAdded(page, tripId, { itemTitle: addedItem, stayName: addedStay });
  }
});
