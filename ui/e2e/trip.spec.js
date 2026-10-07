import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { SEED_ADMIN, SEED_VIEWER, filterMap, login, screenshotPath, tripLink } from "./helpers.js";

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

test("trip search opens a result's own page", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("button", { name: "Search this trip" }).click();
  const search = page.getByRole("dialog", { name: /^Search / });
  await search.getByRole("searchbox", { name: "Search this trip" }).fill("SBB");
  await expect(search.getByRole("link", { name: /Chicago → Zürich/ })).toBeVisible();
  await page.screenshot({ path: screenshotPath("20-trip-search"), fullPage: true });
  await search.getByRole("link", { name: /Chicago → Zürich/ }).click();
  await expect(page.getByRole("article", { name: "Chicago → Zürich" })).toBeVisible();
});

test("top bar: New memory (blue) in place of Share; the drawer's Trip tools; Today's temperature", async ({ page }) => {
  // The sample trip is over, so the server has no weather "now": stand one in.
  await page.route(/\/trips\/[^/]+\/weather$/, (route) =>
    route.fulfill({
      json: { configured: true, today: { place: "Bern", temp: 17.4, icon: "10d", condition: "Rain" }, days: [], alerts: [] },
    })
  );
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("button", { name: "New memory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share trip" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Weather in Bern: 63°F, 17°C" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("05-today-top-bar") });

  await page.getByRole("button", { name: "Open menu" }).click();
  const tools = page.getByRole("region", { name: "Trip tools" });
  await expect(tools.getByRole("link").first()).toHaveText("Currency");
  await expect(tools.getByRole("button", { name: "Share trip" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("05a-drawer-trip-tools") });
  await tools.getByRole("button", { name: "Share trip" }).click();
  await expect(page.getByRole("dialog", { name: "Share trip" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("05b-share-from-drawer") });
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

  // ← (in ☰'s place) goes back to the timeline it came from.
  const timelineUrl = page.url().replace(/\/days\/.*$/, "");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(timelineUrl);
  await expect(page.getByRole("list", { name: "Trip days" })).toBeVisible();
});

test("an entry's own page: a flight, a stay, an activity, and back to the day", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("list", { name: "Trip days" }).getByRole("link", { name: /Mon, May 11/ }).click();
  await expect(page).toHaveURL(/\/days\/2026-05-11$/);
  const plans = page.getByRole("list", { name: "Plans for Mon, May 11" });

  // ⋯ on the day's last activity: the menu floats over the page, not clipped by its row.
  await plans.getByRole("button", { name: "More for Dinner at Kornhauskeller" }).click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: screenshotPath("03d-day-move-menu") });
  await page.keyboard.press("Escape");

  // The overnight flight's arrival opens the flight.
  await plans.getByRole("link", { name: /Arrive · Zürich Airport/ }).click();
  const flight = page.getByRole("article", { name: "Chicago → Zürich" });
  await expect(flight).toBeVisible();
  await expect(flight.getByRole("region", { name: "When" })).toContainText("8h 45m");
  await page.waitForTimeout(1500); // the photo and the mini maps
  await page.screenshot({ path: screenshotPath("04-entry-flight"), fullPage: true });
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/days\/2026-05-11$/);

  await plans.getByRole("link", { name: /Check in · Hotel Goldener/ }).click();
  await expect(page.getByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath("04a-entry-stay"), fullPage: true });
  await page.goBack(); // the phone's back gesture does the same

  await plans.getByRole("link", { name: /Dinner at Kornhauskeller/ }).click();
  const dinner = page.getByRole("article", { name: "Dinner at Kornhauskeller" });
  await expect(dinner).toBeVisible();
  await expect(dinner.getByRole("button", { name: "Edit activity" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath("04b-entry-activity"), fullPage: true });

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Mon, May 11" })).toBeVisible();

  // The day's ← goes on back to the timeline.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("list", { name: "Trip days" })).toBeVisible();
});

test("an entry's page: pull past the bottom for the day's next entry, past the top for its previous; never into another day", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("list", { name: "Trip days" }).getByRole("link", { name: /Mon, May 11/ }).click();
  await page.getByRole("list", { name: "Plans for Mon, May 11" }).getByRole("link", { name: /Check in · Hotel Goldener/ }).click();
  await expect(page.getByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeVisible();
  await page.waitForTimeout(1500); // the photo and the mini map, so the page has its full height

  // Real touches (CDP), so the browser scrolls between them as on a phone.
  const cdp = await context.newCDPSession(page);
  const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 190, y }] });
  async function drag(from, to, { lift = true } = {}) {
    await touch("touchStart", from);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", Math.round(from + ((to - from) * i) / steps));
      await page.waitForTimeout(16);
    }
    if (lift) await touch("touchEnd");
  }
  const scrollTop = () => page.evaluate(() => document.querySelector("[data-scroll-root]").scrollTop);

  // Mid-page, a drag just scrolls.
  await drag(600, 300);
  await page.waitForTimeout(500);
  expect(await scrollTop()).toBeGreaterThan(100);
  await expect(page.getByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeVisible();

  // At the bottom: pull up, and the page says what letting go will do.
  await page.evaluate(() => {
    const root = document.querySelector("[data-scroll-root]");
    root.scrollTop = root.scrollHeight;
  });
  await page.waitForTimeout(300);
  await drag(600, 420, { lift: false });
  await expect(page.getByText("Release for next")).toBeVisible();
  await page.screenshot({ path: screenshotPath("04e-entry-pull-next") });
  await touch("touchEnd");
  await expect(page.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeVisible();
  await expect(page).toHaveURL(/\/activities\//);
  expect(await scrollTop()).toBe(0);
  await page.waitForTimeout(1500);

  // Dinner is May 11's last entry: pulling on past it doesn't reach May 12.
  await page.evaluate(() => {
    const root = document.querySelector("[data-scroll-root]");
    root.scrollTop = root.scrollHeight;
  });
  await page.waitForTimeout(300);
  await drag(600, 400);
  await page.waitForTimeout(400);
  await expect(page.getByText(/for next/)).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeVisible();

  // At the top: pull down for the previous one.
  await page.evaluate(() => {
    document.querySelector("[data-scroll-root]").scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await page.waitForTimeout(500);
  await drag(250, 430, { lift: false });
  await expect(page.getByText("Release for previous")).toBeVisible();
  await page.screenshot({ path: screenshotPath("04f-entry-pull-previous") });
  await touch("touchEnd");
  await expect(page.getByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeVisible();

  // Moving replaced the address: ← goes back to the day, past both entries.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Mon, May 11" })).toBeVisible();
  await page.getByRole("list", { name: "Plans for Mon, May 11" }).getByRole("link", { name: /Dinner at Kornhauskeller/ }).click();
  await expect(page.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeVisible();
  await page.waitForTimeout(1500);

  // A short pull springs back.
  await page.evaluate(() => {
    const root = document.querySelector("[data-scroll-root]");
    root.scrollTop = root.scrollHeight;
  });
  await page.waitForTimeout(300);
  await drag(600, 560);
  await page.waitForTimeout(400);
  await expect(page.getByRole("article", { name: "Dinner at Kornhauskeller" })).toBeVisible();
  await context.close();
});

test("day detail: swipe between days", async ({ browser }) => {
  // A phone: touch events, as well as the mouse.
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  const tripPath = new URL(page.url()).pathname;
  await page.getByRole("list", { name: "Trip days" }).getByRole("link", { name: /Tue, May 12/ }).click();
  // The timeline has a "Tue, May 12" heading too: wait for the day's own page.
  await expect(page).toHaveURL(/\/days\/2026-05-12$/);
  await expect(page.getByText("Day 3 of 5")).toBeVisible();

  // A mouse drag to the left: the next day, and the URL follows.
  await page.mouse.move(320, 400);
  await page.mouse.down();
  await page.mouse.move(200, 405, { steps: 5 });
  await page.screenshot({ path: screenshotPath("03a-day-swipe-mid-drag") });
  await page.mouse.move(40, 410, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/days\/2026-05-13$/);
  await expect(page.getByRole("heading", { name: "Wed, May 13" })).toBeVisible();

  // A mostly vertical drag scrolls; it doesn't change the day.
  await page.mouse.move(200, 600);
  await page.mouse.down();
  await page.mouse.move(215, 250, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/days\/2026-05-13$/);

  // A real touch swipe to the right: back a day.
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", 40, 400);
  for (let x = 80; x <= 340; x += 40) await touch("touchMove", x, 402);
  await touch("touchEnd");
  await expect(page).toHaveURL(/\/days\/2026-05-12$/);
  await expect(page.getByRole("heading", { name: "Tue, May 12" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("03b-day-after-swipe") });

  // Regression: the page scrolls to the end of the day (a fixed carousel
  // height once clipped it).
  const editDay = page.getByRole("button", { name: "Edit Tue, May 12 title and summary" });
  await editDay.scrollIntoViewIfNeeded();
  await expect(editDay).toBeInViewport();

  // Swiping replaced the URL, so Back goes to the timeline, not the last day.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${tripPath}$`));
  await context.close();
});

test("stays and travel coverage views", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await expect(page.getByRole("heading", { name: SAMPLE_TRIP, level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Stays" }).click();
  await page.screenshot({ path: screenshotPath("05-stays-view"), fullPage: true });

  // A covered night opens the stay's own page, where Edit is.
  await page.locator("#day-2026-05-11").getByRole("button").click();
  await expect(page.getByRole("article", { name: "Hotel Goldener Schlüssel" })).toBeVisible();
  await page.getByRole("button", { name: "Edit stay" }).click();
  await expect(page.getByRole("dialog", { name: "Edit stay" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("05a1-stays-view-edit-stay"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Stays" }).click();

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
  // Details opens that place's entry page.
  await infoWindow.getByRole("link", { name: "Details" }).click();
  await expect(page.getByRole("article")).toBeVisible();
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

  // The Filter menu: Stays shows only the sample trip's 2 stays.
  await page.getByRole("button", { name: "Filter the map" }).click();
  await expect(page.getByRole("menu", { name: "Show on the map" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("08a-map-filter-menu") });
  await page.getByRole("menuitemradio", { name: "Stays" }).click();
  await expect(pins).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Filter the map: Stays" })).toBeVisible();
  await page.mouse.move(0, 400); // off the button, so it isn't drawn hovered
  await page.waitForTimeout(800); // the map's new view, and the button's colour transition
  await page.screenshot({ path: screenshotPath("08b-map-filtered-to-stays") });
  // Round-tripping the filter off shouldn't lose any markers (regression:
  // Google Maps silently dropped one of two co-located markers — e.g.
  // Chicago appearing on both the outbound and return flight — when
  // detaching/reattaching instead of rebuilding them).
  await filterMap(page, "Everything");
  await expect(pins).toHaveCount(10);

  // Calendar filter: one day, combined with Stays.
  await page.getByRole("button", { name: "Show one day" }).click();
  await page.getByRole("textbox", { name: "Pick a day" }).fill("2026-05-12");
  await expect(page.getByRole("button", { name: /Showing Tue, May 12/ })).toBeVisible();
  await page.screenshot({ path: screenshotPath("09-map-date-filter"), fullPage: true });
  await filterMap(page, "Stays");
  await expect(pins).toHaveCount(1); // Beausite Park Hotel covers that night
  await page.screenshot({ path: screenshotPath("09a-map-day-and-stays"), fullPage: true });

  // The overnight flight's day: both airports, an ocean apart, and the map
  // zooms out to show them.
  await filterMap(page, "Everything");
  await page.getByRole("button", { name: /Showing Tue, May 12/ }).click();
  await page.getByRole("button", { name: "Show one day" }).click();
  await page.getByRole("textbox", { name: "Pick a day" }).fill("2026-05-10");
  await expect(pins).toHaveCount(2);
  await page.waitForTimeout(1000); // let the map settle on its new view
  await page.screenshot({ path: screenshotPath("09b-map-flight-day"), fullPage: true });
});

/** Delete what a test added through the UI, so the dev trip is left as it was. */
async function deleteAdded(page, tripId, { itemTitle, stayName, poiName }) {
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const api = API_URL;
  const headers = { Authorization: `Bearer ${token}` };
  const trip = await (await page.request.get(`${api}/trips/${tripId}`, { headers })).json();
  for (const day of trip.days) {
    for (const item of day.items.filter((i) => i.title === itemTitle)) {
      await page.request.delete(`${api}/trips/${tripId}/items/${item.id}`, {
        headers: { ...headers, "If-Match": `"${item.version}"` },
      });
    }
  }
  for (const stay of trip.stays.filter((s) => s.name === stayName)) {
    await page.request.delete(`${api}/trips/${tripId}/stays/${stay.id}`, {
      headers: { ...headers, "If-Match": `"${stay.version}"` },
    });
  }
  for (const poi of (trip.pointsOfInterest ?? []).filter((p) => p.name === poiName)) {
    await page.request.delete(`${api}/trips/${tripId}/points-of-interest/${poi.id}`, {
      headers: { ...headers, "If-Match": `"${poi.version}"` },
    });
  }
}

test("map: the List button lists what's shown and jumps to it", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Map" }).click();
  await expect(page.locator("gmp-advanced-marker")).toHaveCount(10);

  // Bottom left, just above Google's logo, which stays in full view.
  const button = page.getByRole("button", { name: "List what's on the map" });
  const logo = page.locator('a[href*="maps.google.com/maps"]').first();
  await expect(logo).toBeVisible();
  const [b, l] = [await button.boundingBox(), await logo.boundingBox()];
  expect(b.y + b.height).toBeLessThanOrEqual(l.y);
  expect(b.x).toBeLessThan(l.x + l.width); // on the left, above it
  await page.waitForTimeout(800);
  await page.screenshot({ path: screenshotPath("08c-map-list-button") });

  await button.click();
  const list = page.getByRole("dialog", { name: "On the map" });
  await expect(list.getByRole("region", { name: "Stays" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("08d-map-list") });
  await list.getByRole("button", { name: /Dinner at Kornhauskeller/ }).click();
  await expect(list).toBeHidden();
  await expect(page.locator(".gm-style-iw")).toContainText("Dinner at Kornhauskeller");
  await page.waitForTimeout(800);
  await page.screenshot({ path: screenshotPath("08e-map-list-picked") });
});

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

test("map: save a Google place as a point of interest, then edit and delete it", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  const tripId = page.url().split("/trips/")[1];
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Map" }).click();
  const pins = page.locator("gmp-advanced-marker");
  await expect(pins).toHaveCount(10);
  const search = page.getByRole("combobox", { name: "Search trip or places" });
  const info = page.locator(".gm-style-iw");
  let added = null;

  try {
    // A department store: "Point of interest" comes first.
    await search.fill("Loeb Bern");
    await page.getByRole("option", { name: /Loeb/ }).first().click();
    await expect(info).toContainText("Not in this trip");
    // Offered straight away, not under More…
    await expect(info.getByRole("button", { name: "Point of interest" })).toBeVisible();
    await info.getByRole("button", { name: "Point of interest" }).click();

    const form = page.getByRole("dialog", { name: "Add point of interest" });
    added = await form.getByLabel("Name").inputValue();
    expect(added).toMatch(/Loeb/);
    await expect(form.getByLabel("Kind")).toHaveValue("shop");
    await form.getByLabel("Notes").fill("Rooftop café on the top floor.");
    await page.screenshot({ path: screenshotPath("16a-map-add-point-of-interest") });
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden();
    await expect(pins).toHaveCount(11); // its own pin; the search result's is gone

    // Its info window: the kind and the notes, then Edit and Delete.
    await page.locator(`gmp-advanced-marker[title="${added}"]`).click();
    await expect(info).toContainText("Point of interest · Shop");
    await expect(info).toContainText("Rooftop café on the top floor.");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotPath("16b-map-point-of-interest-info") });
    await info.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit point of interest" });
    await edit.getByLabel("Kind").selectOption("food");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();

    await page.locator(`gmp-advanced-marker[title="${added}"]`).click();
    await expect(info).toContainText("Point of interest · Food & drink");
    await info.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete point of interest?" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(pins).toHaveCount(10);
    added = null;
  } finally {
    if (added) await deleteAdded(page, tripId, { poiName: added });
  }
});

test("sharing: the owner shares, the viewer reads without edit controls", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    await login(owner);
    await (await tripLink(owner, SAMPLE_TRIP)).click();
    // Share is in the drawer, after Documents.
    await owner.getByRole("button", { name: "Open menu" }).click();
    await owner.getByRole("region", { name: "Trip tools" }).getByRole("button", { name: "Share trip" }).click();
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

test("sharing: someone joins with the edit code and can edit", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  let tripId = null;
  try {
    const owner = await ownerContext.newPage();
    await login(owner);
    await (await tripLink(owner, SAMPLE_TRIP)).click();
    tripId = new URL(owner.url()).pathname.split("/")[2];
    // Share is in the drawer, after Documents.
    await owner.getByRole("button", { name: "Open menu" }).click();
    await owner.getByRole("region", { name: "Trip tools" }).getByRole("button", { name: "Share trip" }).click();
    const canEdit = owner.getByRole("dialog", { name: "Share trip" }).getByRole("region", { name: "Can edit" });
    const code = (await canEdit.locator(".font-mono").textContent()).trim();
    expect(code).toHaveLength(20);
    await owner.screenshot({ path: screenshotPath("21a-share-dialog-codes"), fullPage: true });

    await login(editor, SEED_ADMIN);
    await editor.getByRole("button", { name: "Join trip" }).click();
    const join = editor.getByRole("dialog", { name: "Join a trip" });
    await join.getByLabel("Trip code").fill(code);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await editor.waitForURL(new RegExp(`/trips/${tripId}/today$`));
    await editor.goto(`/trips/${tripId}/days/2026-05-11`);
    await expect(editor.getByRole("heading", { name: "Mon, May 11" })).toBeVisible();
    await expect(editor.getByRole("button", { name: /Add activity/ })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Share trip" })).toHaveCount(0);
  } finally {
    // Leave again, so the dev trip is shared as before.
    if (tripId) {
      const token = await editor.evaluate(() => localStorage.getItem("auth_token")).catch(() => null);
      if (token) {
        await editor.request.delete(`${API_URL}/trips/${tripId}/membership`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
    await ownerContext.close();
    await editorContext.close();
  }
});

test("viewers: Timeline, Journal and Map only; no Stays/Travel views, no Trip tools", async ({ browser }) => {
  // The seed admin isn't on the sample trip: it joins with the view code,
  // is checked as a viewer, then leaves again.
  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  let tripId = null;
  try {
    const owner = await ownerContext.newPage();
    await login(owner);
    await (await tripLink(owner, SAMPLE_TRIP)).click();
    tripId = new URL(owner.url()).pathname.split("/")[2];
    const ownerToken = await owner.evaluate(() => localStorage.getItem("auth_token"));
    const viewCode = (
      await (await owner.request.get(`${API_URL}/trips/${tripId}/view-code`, { headers: { Authorization: `Bearer ${ownerToken}` } })).json()
    ).code;

    await login(viewer, SEED_ADMIN);
    await viewer.getByRole("button", { name: "Join trip" }).click();
    const join = viewer.getByRole("dialog", { name: "Join a trip" });
    await join.getByLabel("Trip code").fill(viewCode);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    // Joining opens Today, which a viewer doesn't get: the timeline instead.
    await viewer.waitForURL(new RegExp(`/trips/${tripId}$`));
    const tabs = viewer.getByRole("navigation", { name: "Trip" }).getByRole("link");
    await expect(tabs).toHaveText(["Timeline", "Journal", "Map"]);
    await expect(viewer.getByRole("group", { name: "Timeline view" })).toHaveCount(0);
    await viewer.screenshot({ path: screenshotPath("23a-viewer-timeline") });

    await viewer.getByRole("button", { name: "Open menu" }).click();
    await expect(viewer.getByRole("navigation", { name: "Menu" })).toBeVisible();
    await expect(viewer.getByRole("region", { name: "Trip tools" })).toHaveCount(0);
    await viewer.screenshot({ path: screenshotPath("23b-viewer-drawer") });
    await viewer.keyboard.press("Escape");

    // A link to a Trip tool lands on the timeline too, with no error toast.
    await viewer.goto(`/trips/${tripId}/weather`);
    await viewer.waitForURL(new RegExp(`/trips/${tripId}$`));
    await expect(viewer.getByTestId("toast-error")).toHaveCount(0);

    // The map: the activities only (the owner sees 10 pins), and the Filter
    // offers Everything and Journal.
    await viewer.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Map" }).click();
    const pins = viewer.locator("gmp-advanced-marker");
    await expect(pins).toHaveCount(4);
    await viewer.getByRole("button", { name: "Filter the map" }).click();
    await expect(viewer.getByRole("menu", { name: "Show on the map" }).getByRole("menuitemradio")).toHaveText(["Everything", "Journal"]);
    await viewer.keyboard.press("Escape");
    await viewer.getByRole("button", { name: "List what's on the map" }).click();
    const list = viewer.getByRole("dialog", { name: "On the map" });
    await expect(list.getByRole("region")).toHaveCount(1); // Activities
    await viewer.waitForTimeout(800);
    await viewer.screenshot({ path: screenshotPath("23c-viewer-map-list") });
  } finally {
    if (tripId) {
      const token = await viewer.evaluate(() => localStorage.getItem("auth_token")).catch(() => null);
      if (token) {
        await viewer.request.delete(`${API_URL}/trips/${tripId}/membership`, { headers: { Authorization: `Bearer ${token}` } });
      }
    }
    await ownerContext.close();
    await viewerContext.close();
  }
});

test("editing: two people change the same activity; the second gets a warning", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const editorContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const editor = await editorContext.newPage();
  const DINNER = "Dinner at Kornhauskeller";
  let tripId = null;
  let original = null;
  const api = async (page, method, path, { body, version } = {}) => {
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const headers = { Authorization: `Bearer ${token}` };
    if (version !== undefined) headers["If-Match"] = `"${version}"`;
    return page.request[method](`${API_URL}${path}`, { headers, data: body });
  };
  const dinnerOf = async (page) => {
    const trip = await (await api(page, "get", `/trips/${tripId}`)).json();
    const day = trip.days.find((d) => d.date === "2026-05-11");
    return day.items.find((i) => i.id === original?.id) ?? day.items.find((i) => i.title === DINNER);
  };
  try {
    await login(owner);
    await (await tripLink(owner, SAMPLE_TRIP)).click();
    tripId = new URL(owner.url()).pathname.split("/")[2];
    original = await dinnerOf(owner);
    const code = (await (await api(owner, "get", `/trips/${tripId}/edit-code`)).json()).code;
    await login(editor, SEED_ADMIN);
    expect((await api(editor, "post", "/trips/join", { body: { code } })).ok()).toBe(true);

    // Both open the dinner's edit form.
    const openEdit = async (page) => {
      await page.goto(`/trips/${tripId}/days/2026-05-11`);
      await page.getByRole("link", { name: new RegExp(DINNER) }).click();
      await page.getByRole("button", { name: "Edit activity" }).click();
      return page.getByRole("dialog");
    };
    const ownerForm = await openEdit(owner);
    const editorForm = await openEdit(editor);

    // The editor saves first.
    await editorForm.getByLabel("Title").fill("Dinner at 8 (editor)");
    await editorForm.getByRole("button", { name: "Save" }).click();
    await expect(editorForm).toBeHidden();

    // The owner's save, made from the old version, is refused: a warning, the form closes,
    // and the owner sees the editor's change.
    await ownerForm.getByLabel("Title").fill("Dinner at 7 (owner)");
    await ownerForm.getByRole("button", { name: "Save" }).click();
    await expect(owner.getByText("Test Admin changed this just now. Showing the latest.")).toBeVisible();
    await expect(ownerForm).toBeHidden();
    await owner.screenshot({ path: screenshotPath("24-edit-conflict"), fullPage: true });
    // The dinner's page is still open, now with the editor's title and who changed it.
    await expect(owner.getByRole("article", { name: "Dinner at 8 (editor)" })).toBeVisible();
    await expect(owner.getByText(/^Edited by Test Admin, /)).toBeVisible();
  } finally {
    // Put the dinner back and leave, so the dev trip is as it was.
    if (tripId && original) {
      const now = await dinnerOf(owner);
      const keep = ["title", "start", "end", "timezone", "location", "confirmationNumber", "notes"];
      const body = Object.fromEntries(keep.filter((k) => k in original).map((k) => [k, original[k]]));
      await api(owner, "put", `/trips/${tripId}/items/${now.id}`, {
        body: { ...body, date: "2026-05-11" },
        version: now.version,
      });
      await api(editor, "delete", `/trips/${tripId}/membership`).catch(() => {});
    }
    await ownerContext.close();
    await editorContext.close();
  }
});

test("journal: a public memory reaches the viewer, a private one doesn't", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const stamp = Date.now();
  const privateText = `E2E private ${stamp}`;
  const publicText = `E2E public ${stamp}`;
  const owner = await ownerContext.newPage();
  const viewer = await viewerContext.newPage();
  const written = [];
  let tripId = null;
  owner.on("response", async (r) => {
    if (r.request().method() === "POST" && /\/memories$/.test(r.url()) && r.ok()) written.push(await r.json());
  });
  try {
    await login(owner);
    await (await tripLink(owner, SAMPLE_TRIP)).click();
    tripId = new URL(owner.url()).pathname.split("/")[2];
    await owner.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Today" }).click();
    for (const [text, shared] of [
      [privateText, false],
      [publicText, true],
    ]) {
      await owner.getByRole("button", { name: "New memory" }).click();
      await owner.getByLabel("What happened?").fill(text);
      if (shared) await owner.getByRole("switch", { name: "Visible to viewers" }).click();
      if (shared) {
        await owner.waitForTimeout(300); // let the switch finish sliding
        await owner.screenshot({ path: screenshotPath("25-memory-public-switch") });
      }
      await owner.getByRole("button", { name: "Save" }).click();
      await expect(owner.getByRole("dialog")).toHaveCount(0);
    }
    await expect.poll(() => written.length).toBe(2);

    await login(viewer, SEED_VIEWER);
    await (await tripLink(viewer, SAMPLE_TRIP)).click();
    const nav = viewer.getByRole("navigation", { name: "Trip" });
    await nav.getByRole("link", { name: "Today" }).click();
    await viewer.getByRole("heading", { level: 1 }).waitFor();
    await expect(viewer.getByRole("button", { name: "New memory" })).toHaveCount(0);
    await nav.getByRole("link", { name: "Journal" }).click();
    await expect(viewer.getByText("What the travelers have shared")).toBeVisible();
    await expect(viewer.getByRole("listitem").filter({ hasText: publicText })).toBeVisible();
    await expect(viewer.getByRole("listitem").filter({ hasText: privateText })).toHaveCount(0);
    await viewer.screenshot({ path: screenshotPath("24-journal-viewer"), fullPage: true });
  } finally {
    const token = await owner.evaluate(() => localStorage.getItem("auth_token")).catch(() => null);
    for (const m of token && tripId ? written : []) {
      await owner.request.delete(`${API_URL}/trips/${tripId}/memories/${m.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    await ownerContext.close();
    await viewerContext.close();
  }
});

