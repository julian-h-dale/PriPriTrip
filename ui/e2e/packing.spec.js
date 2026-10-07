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

test("packing: a quantity, then deleting a whole list", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Packing" }).click();
  await expect(page.getByRole("heading", { name: "Packing" })).toBeVisible();

  // Wait for the list (the first test leaves it started), then open the list if it isn't.
  await expect(page.getByText(/of \d+ packed/)).toBeVisible();
  const beach = page.getByRole("region", { name: "Beach & outdoors" });
  if (!(await beach.isVisible())) {
    await page.getByRole("region", { name: "More lists" }).getByRole("button", { name: "Beach & outdoors" }).click();
  }
  await beach.getByRole("spinbutton", { name: /How many/ }).fill("2");
  await beach.getByRole("textbox", { name: "Add to Beach & outdoors" }).fill("Rash guard");
  await beach.getByRole("button", { name: "Add to Beach & outdoors" }).click();
  await expect(beach.getByRole("checkbox", { name: "Rash guard ×2" })).toBeVisible();
  await beach.screenshot({ path: screenshotPath("53-packing-quantity") });

  await beach.getByRole("button", { name: "More for the Beach & outdoors list" }).click();
  await page.getByRole("menuitem", { name: "Delete list" }).click();
  await page.getByRole("dialog", { name: "Delete the Beach & outdoors list?" }).getByRole("button", { name: "Delete list" }).click();
  await expect(beach).toHaveCount(0);
  await expect(page.getByRole("region", { name: "More lists" }).getByRole("button", { name: "Beach & outdoors" })).toBeVisible();
  await page.screenshot({ path: screenshotPath("54-packing-list-deleted"), fullPage: true });
});
