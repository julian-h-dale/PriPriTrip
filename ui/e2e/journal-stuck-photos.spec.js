import path from "path";
import { fileURLToPath } from "url";
import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath, tripLink } from "./helpers.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
// An iPhone camera photo's shape: a JPEG with a second image (the gain map), "MPO" to Pillow.
const CAMERA = path.join(FIXTURES, "camera-mpo.jpg");
// A GIF named .jpg: the server refuses it the way it refused camera photos before Phase 88.
const REFUSED = path.join(FIXTURES, "not-a-photo.jpg");

test("run 24: a camera photo uploads; a refused one stays on the phone, marked, until removed", async ({ page }) => {
  const text = `Stuck photo ${Date.now()}`;
  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  const tripId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Journal" })).toBeVisible();

  const uploads = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST" && /\/memories\/[^/]+\/photos$/.test(r.url())) uploads.push(r.status());
  });
  await page.getByRole("button", { name: "New memory" }).click();
  const dialog = page.getByRole("dialog", { name: "New memory" });
  await dialog.getByLabel("What happened?").fill(text);
  await dialog.getByLabel("Choose photos").setInputFiles([CAMERA, REFUSED]);
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("region", { name: "Photos waiting to upload" }).getByRole("button", { name: "Upload" }).click();

  const card = page.getByRole("listitem").filter({ hasText: text });
  const stuckBar = page.getByRole("region", { name: "Couldn’t upload" });
  await expect(stuckBar).toContainText("1 couldn’t upload");
  expect(uploads).toEqual([201, 422]); // the camera photo went; the other was refused
  await expect(card.getByText(/A photo couldn’t upload: Only JPEG, PNG, WebP or HEIC photos/)).toBeVisible();
  await expect(card.getByTitle("Couldn’t upload")).toHaveCount(1);

  // Still there after a reload: it's in the outbox, not just on screen.
  await page.reload();
  await expect(card.getByTitle("Couldn’t upload")).toHaveCount(1);
  await expect(stuckBar).toContainText("1 couldn’t upload");
  await page.screenshot({ path: screenshotPath("run24-01-stuck-photo-dark"), fullPage: true });

  await card.getByRole("button", { name: "Photo 2 of 2, couldn’t upload" }).click();
  const viewer = page.getByRole("dialog", { name: "Photo 2 of 2" });
  await expect(viewer.getByRole("button", { name: "Save to phone" })).toBeVisible();
  await expect(viewer.getByText(/Couldn’t upload: Only JPEG/)).toBeVisible();
  await page.screenshot({ path: screenshotPath("run24-02-stuck-viewer"), fullPage: true });
  await viewer.getByRole("button", { name: "Remove" }).click();
  await page.screenshot({ path: screenshotPath("run24-03-stuck-viewer-confirm"), fullPage: true });
  await page.keyboard.press("Escape");

  // The same journal in light mode.
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.reload();
  await expect(card.getByTitle("Couldn’t upload")).toHaveCount(1);
  await page.screenshot({ path: screenshotPath("run24-04-stuck-photo-light"), fullPage: true });
  await page.evaluate(() => localStorage.removeItem("theme"));

  // Remove asks first, then it's gone from the phone.
  await card.getByRole("button", { name: "Photo 2 of 2, couldn’t upload" }).click();
  await viewer.getByRole("button", { name: "Remove" }).click();
  await viewer.getByRole("button", { name: "Delete from this phone" }).click();
  await expect(stuckBar).toHaveCount(0);
  await expect(card.getByTitle("Couldn’t upload")).toHaveCount(0);

  // Clean up (photos go with their memory); the camera photo is stored as a JPEG.
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await (await page.request.get(`${API_URL}/trips/${tripId}/memories`, { headers })).json();
  for (const m of saved.filter((x) => x.text === text)) {
    expect(m.photos).toHaveLength(1);
    const original = await page.request.get(`${API_URL}${m.photos[0].originalUrl}`);
    expect(original.headers()["content-type"]).toBe("image/jpeg");
    for (const p of m.photos) {
      await page.request.delete(`${API_URL}/trips/${tripId}/memories/${m.id}/photos/${p.id}`, { headers });
    }
    await page.request.delete(`${API_URL}/trips/${tripId}/memories/${m.id}`, { headers });
  }
});
