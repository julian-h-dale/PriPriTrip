import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";

// The seed user's own list on the sample trip. The seed doesn't plant one, so
// the first run starts it from suggestions; later runs find it already there.
test("packing: start from suggestions, tick something, it stays ticked", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Packing" }).click();
  await expect(page.getByRole("heading", { name: "Packing" })).toBeVisible();

  const start = page.getByRole("button", { name: "Start from suggestions" });
  const clothes = page.getByRole("region", { name: "Clothes" });
  await expect(start.or(clothes)).toBeVisible();
  if (await start.isVisible()) {
    await page.screenshot({ path: screenshotPath("50-packing-empty"), fullPage: true });
    await start.click();
  }

  const box = clothes.getByRole("checkbox").first();
  const was = await box.isChecked();
  await box.click();
  await expect(box).toBeChecked({ checked: !was });
  await page.screenshot({ path: screenshotPath("51-packing-lists"), fullPage: true });

  await page.reload();
  const again = page.getByRole("region", { name: "Clothes" }).getByRole("checkbox").first();
  await expect(again).toBeChecked({ checked: !was });
});
