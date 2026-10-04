import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { SEED_VIEWER, login, screenshotPath, tripLink } from "./helpers.js";

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
  await expect(await tripLink(page, SAMPLE_TRIP)).toBeVisible();
  await page.screenshot({ path: screenshotPath("01-trips-list"), fullPage: true });
});

test("signing in lands on the next trip; the drawer reaches all trips", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.SEED_USER_EMAIL || "user@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.SEED_USER_PASSWORD || "changeme-user");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/today$/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Next up" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("17-landing"), fullPage: true });

  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Menu" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("18-drawer"), fullPage: true });
  await page.getByRole("link", { name: "All trips" }).click();
  await expect(page.getByRole("heading", { name: "Trips" })).toBeVisible();
});

test("today tab (day 1 preview outside the trip)", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("heading", { name: "Day 1 preview" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Next up" })).toContainText("Chicago → Zürich");
  await page.screenshot({ path: screenshotPath("19-today"), fullPage: true });
});

test("trip search opens a result on its day", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("button", { name: "Search this trip" }).click();
  const search = page.getByRole("dialog", { name: /^Search / });
  await search.getByRole("searchbox", { name: "Search this trip" }).fill("SBB");
  await expect(search.getByRole("link", { name: /Chicago → Zürich/ })).toBeVisible();
  await page.screenshot({ path: screenshotPath("20-trip-search"), fullPage: true });
  await search.getByRole("link", { name: /Chicago → Zürich/ }).click();
  await expect(page.getByRole("button", { name: /Chicago → Zürich/, expanded: true })).toBeVisible();
});

test("trip timeline", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await expect(page.getByRole("heading", { name: SAMPLE_TRIP, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Trip days" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("02-trip-timeline"), fullPage: true });
});

test("day detail page", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
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
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await expect(page.getByRole("heading", { name: SAMPLE_TRIP, level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Stays" }).click();
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

  await page.getByRole("button", { name: "Travel" }).click();
  await page.screenshot({ path: screenshotPath("06-travel-view"), fullPage: true });
});

test("bottom nav and map page", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
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
  await (await tripLink(page, SAMPLE_TRIP)).click();
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
  const api = API_URL;
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
  await (await tripLink(page, SAMPLE_TRIP)).click();
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

test("sharing: the owner shares, the viewer reads without edit controls", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    await login(owner);
    await (await tripLink(owner, SAMPLE_TRIP)).click();
    await owner.getByRole("button", { name: "Share trip" }).click();
    const share = owner.getByRole("dialog", { name: "Share trip" });
    await expect(share.getByText(SEED_VIEWER.email)).toBeVisible();
    await owner.screenshot({ path: screenshotPath("21-share-dialog"), fullPage: true });

    const viewer = await viewerContext.newPage();
    await login(viewer, SEED_VIEWER);
    const link = await tripLink(viewer, SAMPLE_TRIP);
    await expect(link.getByText("Shared with you")).toBeVisible();
    await viewer.screenshot({ path: screenshotPath("22-viewer-trips"), fullPage: true });
    await link.click();
    await expect(viewer.getByRole("button", { name: "Share trip" })).toHaveCount(0);
    await viewer.goto(`${new URL(viewer.url()).pathname}/days/2026-05-11`);
    await expect(viewer.getByRole("heading", { name: "Mon, May 11" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: /Add activity/ })).toHaveCount(0);
    await viewer.screenshot({ path: screenshotPath("23-viewer-day"), fullPage: true });
  } finally {
    await ownerContext.close();
    await viewerContext.close();
  }
});

test("journal: a viewer writes a memory on Today, the owner reads it", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const text = `E2E memory ${Date.now()}`;
  const viewer = await viewerContext.newPage();
  try {
    await login(viewer, SEED_VIEWER);
    await (await tripLink(viewer, SAMPLE_TRIP)).click();
    const nav = viewer.getByRole("navigation", { name: "Trip" });
    await nav.getByRole("link", { name: "Today" }).click();
    await viewer.getByRole("button", { name: "New memory" }).click();
    await viewer.getByLabel("What happened?").fill(text);
    await viewer.getByRole("button", { name: "Save" }).click();
    await expect(viewer.getByRole("dialog")).toHaveCount(0);

    const owner = await ownerContext.newPage();
    await login(owner);
    await (await tripLink(owner, SAMPLE_TRIP)).click();
    await owner.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Journal" }).click();
    const card = owner.getByRole("listitem").filter({ hasText: text });
    await expect(card).toContainText(SEED_VIEWER.email);
    // Someone else's memory: the owner can't edit or delete it.
    await expect(card.getByRole("button", { name: "Memory options" })).toHaveCount(0);
    await owner.screenshot({ path: screenshotPath("24-journal"), fullPage: true });
  } finally {
    // Clean up through the UI as its author.
    await viewer.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Journal" }).click();
    await viewer.getByRole("heading", { name: "Journal" }).waitFor();
    const mine = viewer.getByRole("listitem").filter({ hasText: text });
    // Wait for the list to load before deciding there's nothing to clean up.
    await mine.first().waitFor({ timeout: 5000 }).catch(() => {});
    if (await mine.count()) {
      await mine.getByRole("button", { name: "Memory options" }).click();
      await viewer.getByRole("menuitem", { name: "Delete" }).click();
      // Deleting goes through the outbox: wait for the server to confirm before
      // the browser closes (a real phone would just send it next time).
      const deleted = viewer.waitForResponse(
        (r) => r.request().method() === "DELETE" && r.url().includes("/memories/")
      );
      await viewer.getByRole("dialog", { name: "Delete memory?" }).getByRole("button", { name: "Delete" }).click();
      await expect(viewer.getByRole("listitem").filter({ hasText: text })).toHaveCount(0);
      expect((await deleted).status()).toBe(204);
    }
    await ownerContext.close();
    await viewerContext.close();
  }
});

