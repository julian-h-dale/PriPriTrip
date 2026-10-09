import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

/**
 * Large text (Run stage 23): at Larger, a timed entry row puts its icon and
 * time on a top line and gives the title the card's full width, instead of
 * squeezing it into what the time column leaves. Checked on a day page as an
 * editor (rows with a ⋯ menu) and on Today, in dark and light.
 */
async function expectWideTitles(page, list) {
  const rows = list.locator("li");
  await expect(rows.first()).toBeVisible();
  const tops = list.getByTestId("entry-top-line");
  expect(await tops.count()).toBeGreaterThan(0);
  for (const top of await tops.all()) {
    const row = top.locator("xpath=ancestor::li[1]");
    const card = await row.locator(":scope > div").last().boundingBox();
    const text = await top.locator("xpath=following-sibling::span[1]").boundingBox();
    // The card minus its padding, and the ⋯ menu on editors' rows.
    expect(text.width / card.width).toBeGreaterThan(0.7); // squeezed beside the time column, it was about a third
  }
}

for (const theme of ["dark", "light"]) {
  test(`large text (${theme}): day rows and Today give the title the full width`, async ({ page }) => {
    await page.addInitScript((light) => {
      localStorage.setItem("textSize", "larger");
      if (light) localStorage.setItem("theme", "light");
    }, theme === "light");
    await login(page);

    await (await tripLink(page, SAMPLE_TRIP)).click();
    await page.getByRole("list", { name: "Trip days" }).getByRole("link", { name: /Mon, May 11/ }).click();
    const plans = page.getByRole("list", { name: "Plans for Mon, May 11" });
    await expect(plans.getByRole("button", { name: /^More for / }).first()).toBeVisible();
    await expectWideTitles(page, plans);
    await page.screenshot({ path: screenshotPath(`23a-larger-day-${theme}`), fullPage: true });

    await page.goto("/trips");
    await (await tripLink(page, "Athens Getaway")).click();
    await page.waitForTimeout(1200);
    const plan = page.getByRole("region", { name: "Today’s plan" });
    await expectWideTitles(page, plan);
    await plan.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath(`23b-larger-today-${theme}`) });
  });
}
