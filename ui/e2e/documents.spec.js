import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { login, screenshotPath, tripLink } from "./helpers.js";

const SAMPLE_TRIP = "Bern & Wengen Long Weekend";
const NAME = `E2E ticket ${Date.now()}`;

// Adds a document to the seed user's sample trip, downloads everything as a
// zip, checks the file is in it, then deletes the document again.
test("documents: add one, download all as a zip, delete it", async ({ page }) => {
  await login(page);
  await (await tripLink(page, SAMPLE_TRIP)).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

  await page.getByTestId("document-file").setInputFiles({
    name: `${NAME}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 e2e ticket"),
  });
  await expect(page.getByRole("list", { name: "Documents" }).getByText(NAME)).toBeVisible();
  await page.screenshot({ path: screenshotPath("52-documents"), fullPage: true });

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all (zip)" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${SAMPLE_TRIP} documents.zip`);
  const zip = fs.readFileSync(await download.path());
  expect(zip.subarray(0, 2).toString()).toBe("PK");
  expect(zip.includes(Buffer.from(`${NAME}.pdf`))).toBe(true);

  await page.getByRole("button", { name: `More for ${NAME}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: `Delete “${NAME}”?` }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(NAME)).toHaveCount(0);
});
