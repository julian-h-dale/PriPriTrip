import { test, expect } from "@playwright/test";
import { login, screenshotPath, SEED_VIEWER, tripLink } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";
const RAINY = "Wed, May 13"; // the sample's Männlichen day, with a rainy-day plan B

/**
 * Plan B (Run stage 25): a day's backup plan, switched to with the fork
 * button by the date on the day page, on this phone only. The booking rows stay; the activities swap. Editors
 * (and the owner) only: a viewer has no switch. Dark and light at 375 px.
 */
async function openRainyDay(page) {
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("list", { name: "Trip days" }).getByRole("link", { name: new RegExp(RAINY) }).click();
  await expect(page.getByRole("heading", { name: RAINY })).toBeVisible();
}

for (const theme of ["dark", "light"]) {
  test(`plan B (${theme}): switch, open, come back, add`, async ({ page }) => {
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await login(page);
    await openRainyDay(page);

    const planBButton = page.getByRole("button", { name: "Plan B", exact: true });
    await expect(planBButton).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("link", { name: /Männlichen → Kleine Scheidegg hike/ })).toBeVisible();
    await page.screenshot({ path: screenshotPath(`25a-plan-a-${theme}`), fullPage: true });

    await planBButton.click();
    const planB = page.getByRole("list", { name: `Plan B for ${RAINY}` });
    await expect(planB.getByRole("link", { name: /Trümmelbach Falls/ })).toBeVisible();
    await expect(planB.getByText("Staying at Beausite Park Hotel")).toBeVisible(); // staying there: both plans
    await expect(page.getByRole("link", { name: /Männlichen → Kleine Scheidegg hike/ })).toHaveCount(0);
    // Fits at phone width: no sideways scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await expect(planBButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("header").filter({ has: page.getByRole("heading", { name: RAINY }) }).getByText("Plan B", { exact: true })).toBeVisible();
    await page.waitForTimeout(300); // let the button's colour transition finish
    await page.screenshot({ path: screenshotPath(`25b-plan-b-${theme}`), fullPage: true });

    await planB.getByRole("link", { name: /Trümmelbach Falls/ }).click();
    const article = page.getByRole("article");
    await expect(article.getByText("Plan B", { exact: true })).toBeVisible();
    await page.screenshot({ path: screenshotPath(`25c-plan-b-entry-${theme}`) });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("list", { name: `Plan B for ${RAINY}` })).toBeVisible();

    // Add one to plan B: the form starts with Plan B on.
    await page.getByRole("button", { name: `Add activity to plan B for ${RAINY}` }).click();
    const dialog = page.getByRole("dialog", { name: "Add activity" });
    await expect(dialog.getByRole("switch", { name: "Plan B" })).toHaveAttribute("aria-checked", "true");
    const title = `Chocolate shop (${theme})`;
    await dialog.getByLabel("Title").fill(title);
    await page.screenshot({ path: screenshotPath(`25d-plan-b-form-${theme}`) });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(planB.getByRole("link", { name: new RegExp(title.replace(/[()]/g, "\\$&")) })).toBeVisible();

    // Tidy up: delete it again.
    await planB.getByRole("link", { name: new RegExp(title.replace(/[()]/g, "\\$&")) }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("list", { name: `Plan B for ${RAINY}` })).toBeVisible();

    // Back to the plan for the next run.
    await page.getByRole("button", { name: "Plan B", exact: true }).click();
    await expect(page.getByRole("button", { name: "Plan B", exact: true })).toHaveAttribute("aria-pressed", "false");
  });
}

test("plan B: a viewer has no plan B button and sees the plan", async ({ page }) => {
  await login(page, SEED_VIEWER);
  await openRainyDay(page);
  await expect(page.getByRole("link", { name: /Männlichen → Kleine Scheidegg hike/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan B", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Trümmelbach/)).toHaveCount(0);
  await page.screenshot({ path: screenshotPath("25e-plan-b-viewer"), fullPage: true });
});
