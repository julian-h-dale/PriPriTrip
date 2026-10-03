import { test, expect } from "@playwright/test";
import { login, screenshotPath } from "./helpers.js";

/**
 * Installable app + offline, against a *built* app — the service worker
 * doesn't run under `vite dev`. Skipped unless PREVIEW_URL is set:
 *
 *   cd ui && npm run build && npm run preview          # :4173
 *   PREVIEW_URL=http://localhost:4173 npx playwright test e2e/offline.spec.js
 *
 * (The preview's API must allow that origin in CORS_ORIGINS — see README.)
 */
const PREVIEW_URL = process.env.PREVIEW_URL;
test.skip(!PREVIEW_URL, "set PREVIEW_URL to a built app (vite preview / make run-container)");
test.use({ baseURL: PREVIEW_URL });

test("manifest and icons are served", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "PriPriTrip", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons) {
    expect((await request.get(`/${icon.src}`)).ok(), icon.src).toBe(true);
  }
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
});

test("trips open offline from the saved copy, read-only, and refresh when back online", async ({ page, context }) => {
  await login(page);
  // The service worker takes control of the page once it's installed.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole("heading", { name: "Trips" }).waitFor();
  const tripLinks = page.locator("ul li a");
  // The last trip is never opened here: it's only offline thanks to the
  // background caching of trips that haven't ended (it must be upcoming).
  const unopenedUrl = await tripLinks.last().getAttribute("href");
  const unopenedName = (await tripLinks.last().locator("span").first().textContent()).trim();
  const firstTrip = tripLinks.first();
  const tripName = (await firstTrip.locator("span").first().textContent()).trim();
  await firstTrip.click();
  await page.getByRole("heading", { level: 1, name: tripName }).waitFor();
  const tripUrl = new URL(page.url()).pathname;
  const firstDay = page.getByRole("list", { name: "Trip days" }).getByRole("link").first();
  const dayUrl = await firstDay.getAttribute("href");

  await context.setOffline(true);

  // Every page reloads from the service worker (shell) + IndexedDB (data).
  await page.goto("/");
  await expect(page.getByText(tripName)).toBeVisible();
  await expect(page.getByText(/^Offline · read-only/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Import trip/ })).toBeDisabled();
  await page.screenshot({ path: screenshotPath("10-offline-trips"), fullPage: true });

  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { level: 1, name: tripName })).toBeVisible();
  await expect(page.getByText(/^Offline · read-only · saved copy from/)).toBeVisible();
  await page.screenshot({ path: screenshotPath("11-offline-timeline"), fullPage: true });

  await page.goto(unopenedUrl);
  await expect(page.getByRole("heading", { level: 1, name: unopenedName })).toBeVisible();

  await page.goto(dayUrl);
  await expect(page.getByRole("button", { name: /Add activity/ })).toBeDisabled();
  await page.screenshot({ path: screenshotPath("12-offline-day"), fullPage: true });

  await page.goto(`${tripUrl}/map`);
  await expect(page.getByText(/The map needs a connection/)).toBeVisible();
  await page.screenshot({ path: screenshotPath("13-offline-map"), fullPage: true });

  await context.setOffline(false);
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { level: 1, name: tripName })).toBeVisible();
  await expect(page.getByText(/read-only/)).toHaveCount(0);
});
