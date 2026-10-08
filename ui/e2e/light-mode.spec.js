import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

/**
 * Light mode (Run stage 22): switched on from the All trips drawer,
 * remembered across a reload (no dark flash: it's on <html> before the app
 * runs), then every page photographed at 375 px for a human to look at.
 */
test("light mode: on from the drawer, remembered, and every page in it", async ({ page, context }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("switch", { name: "Light mode" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.screenshot({ path: screenshotPath("22a-light-drawer") });
  await page.keyboard.press("Escape");

  // Before any script of the app's runs, the saved choice is already applied.
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("heading", { name: "Trips" }).waitFor();
  await page.screenshot({ path: screenshotPath("22b-light-trips"), fullPage: true });

  await (await tripLink(page, "Athens Getaway")).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath("22c-light-today"), fullPage: true });
  const trip = new URL(page.url()).pathname.replace(/\/today$/, "");
  const shots = [
    ["", "22d-light-timeline"],
    ["/journal", "22e-light-journal"],
    ["/map", "22f-light-map"],
    ["/weather", "22g-light-weather"],
    ["/currency", "22h-light-currency"],
    ["/packing", "22i-light-packing"],
  ];
  for (const [path, name] of shots) {
    await page.goto(trip + path);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: screenshotPath(name), fullPage: path !== "/map" });
  }
  await page.goto(trip);
  await page.getByRole("button", { name: "Stays" }).click();
  await page.screenshot({ path: screenshotPath("22j-light-stays") });
  await page.getByRole("button", { name: "Plan" }).click();
  await page.locator('a[href*="/days/"]').nth(2).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: screenshotPath("22k-light-day"), fullPage: true });
  await page.getByRole("link", { name: /Acropolis Museum/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath("22l-light-entry"), fullPage: true });
  await page.getByRole("button", { name: "New memory" }).click();
  await page.screenshot({ path: screenshotPath("22m-light-dialog") });
  await page.keyboard.press("Escape");

  await context.setOffline(true);
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, trip);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath("22n-light-offline") });
});

test("text size: the timeline's dot stays on its date at every size", async ({ page }) => {
  await login(page);
  const offsets = {};
  for (const [label, scale] of [["Normal", 1], ["Large", 1.125], ["Larger", 1.25]]) {
    await page.goto("/trips");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("radio", { name: label, exact: true }).click();
    await page.keyboard.press("Escape");
    await (await tripLink(page, "Athens Getaway")).click();
    await page.getByRole("link", { name: "Timeline", exact: true }).click();
    const row = page.locator('li[id^="day-"]').first();
    const dot = await row.locator("span.rounded-full").first().boundingBox();
    const date = await row.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /).first().boundingBox();
    offsets[label] = (dot.y + dot.height / 2 - (date.y + date.height / 2)) / scale;
    if (label === "Larger") {
      await page.screenshot({ path: screenshotPath("22o-larger-timeline") });
      await page.getByRole("link", { name: "Today", exact: true }).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: screenshotPath("22p-larger-today") });
    }
  }
  // The same place relative to the date, whatever the size (within a pixel or two).
  expect(Math.abs(offsets.Large - offsets.Normal)).toBeLessThan(2);
  expect(Math.abs(offsets.Larger - offsets.Normal)).toBeLessThan(2);
  expect(Math.abs(offsets.Normal)).toBeLessThan(4); // and it's on the date to begin with
});
