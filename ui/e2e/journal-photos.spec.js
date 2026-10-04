import path from "path";
import { fileURLToPath } from "url";
import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath, tripLink } from "./helpers.js";

const LAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "lake.jpg");

test("photos: added offline, held on the phone until Upload, viewed full screen", async ({ page, context }) => {
  const text = `Photo memory ${Date.now()}`;
  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  const tripId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Journal" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "New memory" }).click();
  const dialog = page.getByRole("dialog", { name: "New memory" });
  await dialog.getByLabel("What happened?").fill(text);
  await dialog.getByLabel("Choose photos").setInputFiles([LAKE, LAKE]);
  await expect(dialog.getByRole("button", { name: /^Remove new photo/ })).toHaveCount(2);
  await page.screenshot({ path: screenshotPath("28-memory-photos-picked"), fullPage: true });
  await dialog.getByRole("button", { name: "Save" }).click();

  const card = page.getByRole("listitem").filter({ hasText: text });
  await expect(card.getByTitle("Waiting to upload")).toHaveCount(2); // shown from the phone's copy
  const uploads = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST" && /\/memories\/[^/]+\/photos$/.test(r.url())) uploads.push(r.status());
  });
  await context.setOffline(false);
  // Back online, the memory syncs by itself but its photos wait for Upload.
  await expect(card.getByText("Waiting to sync")).toHaveCount(0);
  const bar = page.getByRole("region", { name: "Photos waiting to upload" });
  await expect(bar).toContainText("2 photos waiting");
  await expect(card.getByTitle("Waiting to upload")).toHaveCount(2);
  expect(uploads).toEqual([]);
  await page.screenshot({ path: screenshotPath("29a-photos-waiting"), fullPage: true });
  await bar.getByRole("button", { name: "Upload" }).click();
  await expect(card.getByTitle("Waiting to upload")).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  expect(uploads).toEqual([201, 201]);
  await expect(card.locator("img")).toHaveCount(2);
  await page.screenshot({ path: screenshotPath("29-journal-photos"), fullPage: true });

  await card.getByRole("button", { name: "Photo 1 of 2" }).click();
  const viewer = page.getByRole("dialog", { name: "Photo 1 of 2" });
  await expect(viewer.locator("img")).toHaveAttribute("src", /\/photos\/[0-9a-f-]{36}\/display$/);
  await page.screenshot({ path: screenshotPath("30-photo-viewer"), fullPage: true });
  await viewer.getByRole("button", { name: "Full quality" }).click();
  await expect(viewer.locator("img")).toHaveAttribute("src", /\/original$/);
  await page.keyboard.press("Escape");

  // Clean up (photos go with their memory).
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await (await page.request.get(`${API_URL}/trips/${tripId}/memories`, { headers })).json();
  for (const m of saved.filter((x) => x.text === text)) {
    expect(m.photos).toHaveLength(2);
    for (const p of m.photos) {
      await page.request.delete(`${API_URL}/trips/${tripId}/memories/${m.id}/photos/${p.id}`, { headers });
    }
    await page.request.delete(`${API_URL}/trips/${tripId}/memories/${m.id}`, { headers });
  }
});
