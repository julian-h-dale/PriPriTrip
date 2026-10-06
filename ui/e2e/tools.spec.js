import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

/**
 * The trip tools (Weather, Currency) from the ☰ drawer, and the All trips
 * countdown — screenshots at phone width. Weather needs OPENWEATHER_API_KEY
 * on the API for real forecasts; without it the page says it isn't set up.
 * Currency calls Frankfurter from the browser, so it needs the internet.
 */
test("trip tools: Weather, Currency and Time zones from the drawer", async ({ page }) => {
  await login(page);
  await page.screenshot({ path: screenshotPath("30-trips-countdown"), fullPage: true });
  await (await tripLink(page, SAMPLE_TRIP)).click();

  await page.getByRole("button", { name: "Open menu" }).click();
  const tools = page.getByRole("navigation", { name: "Menu" }).getByRole("region", { name: "Trip tools" });
  await page.screenshot({ path: screenshotPath("31-drawer-trip-tools") });
  await tools.getByRole("link", { name: "Weather" }).click();
  await expect(page.getByRole("heading", { name: "Weather" })).toBeVisible();
  await expect(page.getByText(/Weather isn’t set up|Trip days|Couldn’t load the weather/).first()).toBeVisible();
  await page.screenshot({ path: screenshotPath("32-weather"), fullPage: true });

  // A tool page has ← in place of ☰: back to the trip, then the drawer again.
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
  const tripUrl = page.url().replace(/\/weather$/, "");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).not.toHaveURL(/\/weather$/);
  expect(page.url().startsWith(tripUrl)).toBe(true);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Currency" }).click();
  await expect(page.getByRole("heading", { name: "Currency" })).toBeVisible();
  const chips = page.getByRole("group", { name: "Currencies" });
  await expect(chips.getByRole("button", { name: "CHF" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Rate" })).toContainText("1 USD =");
  await page.getByLabel("Amount in CHF").fill("50");
  await expect(page.getByRole("region", { name: "Calculator" })).toContainText("$");
  await page.screenshot({ path: screenshotPath("33-currency"), fullPage: true });

  // Time zones: a live clock for each zone on the trip (Chicago, Zürich).
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Time zones" }).click();
  await expect(page.getByRole("heading", { name: "Time zones" })).toBeVisible();
  const zones = page.getByRole("region", { name: "The trip's time zones" });
  await expect(zones.getByRole("region")).toHaveCount(2);
  await expect(zones.getByRole("region").nth(1)).toContainText(/Zürich|Bern/);
  await page.screenshot({ path: screenshotPath("35-time-zones"), fullPage: true });
});

test("trip tools: the Weather page's layout, with a made-up forecast", async ({ page }) => {
  const at = new Date().toISOString();
  const day = (date, extra) => ({ date, place: "Naha", zone: "Asia/Tokyo", fetchedAt: at, ...extra });
  await page.route(/\/trips\/[^/]+\/weather$/, (route) =>
    // The page itself lives at /trips/<id>/weather too: only fake the API call.
    route.request().resourceType() === "document"
      ? route.continue()
      : route.fulfill({
      json: {
        configured: true,
        problem: null,
        today: {
          place: "Naha", zone: "Asia/Tokyo", observedAt: at, temp: 27.5, feelsLike: 30.1, condition: "Clouds",
          description: "broken clouds", icon: "04d", humidity: 75, windSpeed: 4, uvi: 6,
          sunrise: "2026-10-29T21:12:00Z", sunset: "2026-10-30T08:40:00Z", fetchedAt: at,
        },
        days: [
          day("2026-10-29", { kind: "forecast", high: 28, low: 22, pop: 0.4, rain: 2.4, windSpeed: 5.5, windGust: 9, uvi: 7.1, humidity: 70, icon: "10d", summary: "Expect a day of partly cloudy with rain", sunrise: "2026-10-28T21:12:00Z", sunset: "2026-10-29T08:41:00Z" }),
          day("2026-10-30", { kind: "forecast", high: 29, low: 23, pop: 0.05, windSpeed: 3, uvi: 8, humidity: 60, icon: "01d", summary: "Clear sky all day" }),
          day("2026-11-09", { place: "Taipei", zone: "Asia/Taipei", kind: "outlook", high: 26.5, low: 21, rain: 3.2, windSpeed: 7.7, humidity: 68 }),
          { date: "2026-11-13", place: "Taipei", kind: "unavailable" },
        ],
        alerts: [{ place: "Naha", event: "Typhoon warning", sender: "Japan Meteorological Agency", start: at, end: at, description: "Strong winds expected." }],
      },
    })
  );
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  const tripId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/trips/${tripId}/weather`);
  await expect(page.getByRole("region", { name: "Right now" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("34-weather-forecast"), fullPage: true });
});
