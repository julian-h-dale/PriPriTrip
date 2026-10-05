import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { login, screenshotPath, tripLink } from "./helpers.js";

/**
 * Memories written with no connection wait in the phone's outbox and sync,
 * once each and in the order written, when the connection comes back.
 * Runs against the dev server (no service worker needed: the page stays
 * loaded while the browser goes offline).
 */
test("journal: offline memories sync once, in order, when back online", async ({ page, context }) => {
  const stamp = Date.now();
  const first = `Offline first ${stamp}`;
  const second = `Offline second ${stamp}`;
  await login(page); // the owner (viewers don't write memories)
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  const tripId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Journal" })).toBeVisible();

  const posts = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/trips/${tripId}/memories`)) posts.push(r.postDataJSON());
  });

  await context.setOffline(true);
  for (const text of [first, second]) {
    await page.getByRole("button", { name: "New memory" }).click();
    await page.getByLabel("What happened?").fill(text);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: text })).toContainText("Waiting to sync");
  }
  await page.screenshot({ path: screenshotPath("25-journal-offline"), fullPage: true });

  await context.setOffline(false); // the app hears "online" and sends the outbox
  for (const text of [first, second]) {
    await expect(page.getByRole("listitem").filter({ hasText: text })).not.toContainText("Waiting to sync");
  }
  const sent = posts.filter((b) => b.text === first || b.text === second);
  expect(sent.map((b) => b.text)).toEqual([first, second]); // each once, in order
  expect(Date.parse(sent[0].createdAt)).toBeLessThan(Date.parse(sent[1].createdAt));

  // The server has exactly one of each, in the order they were written.
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await (await page.request.get(`${API_URL}/trips/${tripId}/memories`, { headers })).json();
  const mine = saved.filter((m) => m.text === first || m.text === second);
  expect(mine.map((m) => m.text)).toEqual([first, second]);

  // Clean up.
  for (const m of mine) {
    await page.request.delete(`${API_URL}/trips/${tripId}/memories/${m.id}`, { headers });
  }
});
