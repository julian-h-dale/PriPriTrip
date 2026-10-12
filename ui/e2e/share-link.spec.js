import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

/**
 * A trip's secret link (Run stage 31): the owner turns it on in Trip
 * settings → People; a browser with no account opens it and reads the trip
 * as a viewer; after Make a new link, the old one says it doesn't work.
 * Turned off again after. Dark and light at 375 px.
 */
test.describe.configure({ mode: "serial" });

for (const theme of ["dark", "light"]) {
  test(`secret link (${theme})`, async ({ page, browser }) => {
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const headers = { Authorization: `Bearer ${token}` };
    const trips = await (await page.request.get(`${API_URL}/trips`, { headers })).json();
    const tripId = trips.find((t) => t.name === SAMPLE_TRIP).id;
    const off = () => page.request.delete(`${API_URL}/trips/${tripId}/link`, { headers });
    await off();

    const family = await browser.newContext({ colorScheme: theme });
    try {
      await page.goto(`/trips/${tripId}/settings`);
      const sharing = page.getByRole("region", { name: "Link sharing" });
      await sharing.getByRole("switch", { name: "Anyone with the link can view" }).click();
      const firstLink = await sharing.getByText(/\/s\//).textContent();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      await sharing.scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshotPath(`31a-link-sharing-${theme}`) });

      // Family: no account, straight onto the trip, as a viewer.
      const guest = await family.newPage();
      if (theme === "light") await guest.addInitScript(() => localStorage.setItem("theme", "light"));
      await guest.goto(new URL(firstLink).pathname);
      await expect(guest).toHaveURL(new RegExp(`/trips/${tripId}$`));
      await expect(guest.getByRole("heading", { name: SAMPLE_TRIP, level: 1 })).toBeVisible();
      await expect(guest.getByRole("group", { name: "Timeline view" })).toHaveCount(0); // a viewer's timeline
      await guest.getByRole("button", { name: "Open menu" }).click();
      await expect(guest.getByRole("button", { name: "Change password" })).toHaveCount(0);
      await expect(guest.getByText("You’ll need the link again to come back.")).toBeVisible();
      await guest.screenshot({ path: screenshotPath(`31b-guest-${theme}`) });
      await guest.getByRole("button", { name: "Close menu" }).click();

      // A new link: the old one stops, and the guest is signed out.
      await sharing.getByRole("button", { name: "Make a new link" }).click();
      await page.getByRole("dialog", { name: "Make a new link?" }).getByRole("button", { name: "Make a new link" }).click();
      await expect(sharing.getByText(/\/s\//)).not.toHaveText(firstLink);
      // Still in the app: the next request says the link ended (no sign-in page).
      await guest.reload();
      await expect(guest).toHaveURL(/\/link-ended$/);
      await expect(guest.getByRole("heading", { name: "This link doesn’t work any more" })).toBeVisible();
      // And the old link itself.
      await guest.goto(new URL(firstLink).pathname);
      await expect(guest.getByRole("heading", { name: "This link doesn’t work any more" })).toBeVisible();
      await guest.screenshot({ path: screenshotPath(`31c-dead-link-${theme}`) });
    } finally {
      await family.close();
      await off();
    }
  });
}
