import { test, expect } from "@playwright/test";
import { SEED_ADMIN, login, screenshotPath, tripLink } from "./helpers.js";

/**
 * Usage analytics (Run stages 18–19), sent to a pretend Umami host, so what
 * the app sends is checked without counting anything for real.
 */
const UMAMI = "https://umami.test";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

/** Point the app at the pretend Umami; returns what it sends, as it arrives. */
async function fakeUmami(page) {
  const sent = [];
  await page.route(/\/config$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, umamiUrl: UMAMI, umamiWebsiteId: "site-id" } });
  });
  await page.route(`${UMAMI}/api/send`, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: {}, headers: CORS });
  });
  return { sent };
}

async function go(page, to) {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await page.waitForTimeout(800);
}

test("an owner's page views: page names with the role, never an id", async ({ page }) => {
  const umami = await fakeUmami(page);
  await login(page);
  await page.waitForTimeout(800); // a page counts once it has been on screen a moment
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  await page.waitForTimeout(1000);
  const trip = new URL(page.url()).pathname.replace(/\/today$/, "");
  for (const p of ["", "/map", "/journal", "/days/2026-05-11", "/days/2026-05-12", "/packing"]) await go(page, trip + p);
  await page.screenshot({ path: screenshotPath("18a-analytics-owner") });

  const views = umami.sent.filter((s) => s.type === "event" && !s.payload.name);
  const urls = views.map((s) => s.payload.url);
  expect(urls).toEqual(
    expect.arrayContaining(["/trips", "/trip/timeline", "/trip/map", "/trip/journal", "/trip/day", "/trip/packing"]),
  );
  expect(urls.filter((u) => u === "/trip/day")).toHaveLength(2); // each day counts
  for (const { payload } of views.filter((v) => v.payload.url.startsWith("/trip/"))) {
    expect(payload.tag).toBe("owner");
    expect(payload.data).toEqual({ role: "owner" });
  }
  expect(JSON.stringify(umami.sent)).not.toMatch(UUID);
  expect(JSON.stringify(umami.sent)).not.toContain("Bern"); // no trip names either
  expect(umami.sent.some((s) => s.payload.url?.includes("login"))).toBe(false);
});

test("a viewer's page views say viewer", async ({ page }) => {
  // The role is the trip read's `role`. (The seed viewer's password differs
  // between machines, so the seed user's trip is read back as a viewer's.)
  const umami = await fakeUmami(page);
  await page.route(new RegExp(`/trips/${UUID.source}$`), async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), role: "viewer" } });
  });
  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  await page.waitForTimeout(1000);
  const trip = new URL(page.url()).pathname.replace(/\/today$/, "");
  await go(page, `${trip}/map`);
  const map = umami.sent.find((s) => s.payload.url === "/trip/map");
  expect(map.payload).toMatchObject({ tag: "viewer", data: { role: "viewer" } });
  await page.screenshot({ path: screenshotPath("18b-analytics-viewer") });
});

test("an admin (off by default) sends nothing", async ({ page }) => {
  const umami = await fakeUmami(page);
  await login(page, SEED_ADMIN);
  await page.goto("/admin");
  await expect(page.getByRole("combobox", { name: `Analytics for ${SEED_ADMIN.email}` })).toHaveValue("off");
  await page.waitForTimeout(800);
  expect(umami.sent).toHaveLength(0);
  await page.screenshot({ path: screenshotPath("18c-admin-analytics-column"), fullPage: true });
});

test("Trip tools: opened from the drawer, and used", async ({ page }) => {
  const umami = await fakeUmami(page);
  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  await page.waitForTimeout(1000);
  const trip = new URL(page.url()).pathname.replace(/\/today$/, "");
  await go(page, trip);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Currency" }).click();
  await page.getByLabel(/^Amount in /).fill("100");
  await page.waitForTimeout(800);
  await go(page, `${trip}/time`);
  await page.screenshot({ path: screenshotPath("18d-analytics-tools") });

  const events = umami.sent.filter((s) => s.payload.name).map((s) => s.payload);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "tool-open", tag: "owner", data: { role: "owner", tool: "currency" } }),
      expect.objectContaining({ name: "currency-convert", url: "/trip/currency", tag: "owner" }),
      expect.objectContaining({ name: "timezones-view", url: "/trip/timezones", tag: "owner" }),
    ]),
  );
  expect(events.filter((e) => e.name === "currency-convert")).toHaveLength(1); // not per keystroke
  expect(JSON.stringify(umami.sent)).not.toMatch(UUID);
});

test("offline: what's done is kept on the phone and sent, with its own time, when back", async ({ page, context }) => {
  const umami = await fakeUmami(page);
  await login(page);
  await (await tripLink(page, "Bern & Wengen Long Weekend")).click();
  await page.waitForTimeout(1500); // the trip saved on the phone
  const trip = new URL(page.url()).pathname.replace(/\/today$/, "");

  await context.setOffline(true);
  const before = umami.sent.length;
  const wentOffline = Date.now() / 1000;
  await go(page, `${trip}/map`);
  await go(page, `${trip}/journal`);
  await page.waitForTimeout(8000); // long enough that a send-time stamp would show
  expect(umami.sent).toHaveLength(before); // nothing got out

  await context.setOffline(false);
  await expect.poll(() => umami.sent.slice(before).map((s) => s.payload.url)).toEqual(["/trip/map", "/trip/journal"]);
  for (const { payload } of umami.sent.slice(before)) {
    expect(payload.tag).toBe("owner");
    // Stamped when it happened (offline), not when it was sent.
    expect(payload.timestamp).toBeGreaterThanOrEqual(Math.floor(wentOffline));
    expect(payload.timestamp).toBeLessThan(Math.floor(wentOffline) + 6);
  }
});
