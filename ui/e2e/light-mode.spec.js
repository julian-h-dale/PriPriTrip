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
