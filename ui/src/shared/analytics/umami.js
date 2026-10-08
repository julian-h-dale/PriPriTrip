import { createStore, del, entries, set } from "idb-keyval";

/**
 * Usage analytics to Umami (Run stages 18–19): the one place that talks to
 * it. Nothing is sent unless the signed-in person's switch is on
 * (`analytics_enabled`, set on the Admin page) and the server gave an Umami
 * address and website id (GET /config).
 *
 * No Umami script: we post to its `/api/send` ourselves, so it works in an
 * app opened offline. Every event goes into a queue on the phone first
 * (IndexedDB, per user) with the time it happened (`timestamp`, which
 * Umami 3.4 uses as the event's time), then the queue is sent oldest first:
 * straight away, when the connection comes back, and when the app comes
 * back to the front. A server answer takes an event off the queue; no
 * answer, or a 5xx, leaves it for the next try.
 *
 * We never send Umami's `x-umami-cache` token: with it, a late event would
 * join the current visit instead of the hour it happened in.
 *
 * What's sent is a page's name, never its address (pages.js), with the
 * person's role on the trip as the tag and as event data. Failures are
 * silent: analytics never toasts and never breaks a page.
 */

const MAX_QUEUED = 500;
const MAX_AGE_S = 30 * 24 * 60 * 60;
// Before it's known whether this person is counted (the first moments of a
// load), events wait in memory; enough for the first screen or two.
const MAX_UNDECIDED = 20;
const SETTINGS_KEY = (userId) => `analytics:${userId}`;

let decided = false;
let target = null; // { umamiUrl, umamiWebsiteId, userId } while on
let undecided = [];
let flushing = null;
let sentReferrer = false;
let seq = 0;
let held = false; // "Use saved copies only": keep queueing, send nothing

let store;
function db() {
  store ??= createStore("pripritrip-analytics", "events");
  return store;
}

async function safely(fn, fallback = null) {
  try {
    if (typeof indexedDB === "undefined") return fallback;
    return await fn();
  } catch {
    return fallback;
  }
}

const now = () => Math.floor(Date.now() / 1000);

// ---- remembering the switch on the phone, for an app opened offline ----

/** The Umami settings remembered for `userId` (their switch was on), or null. */
export function rememberedSettings(userId) {
  try {
    const raw = userId && localStorage.getItem(SETTINGS_KEY(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function remember(userId, config) {
  try {
    localStorage.setItem(
      SETTINGS_KEY(userId),
      JSON.stringify({ umamiUrl: config.umamiUrl, umamiWebsiteId: config.umamiWebsiteId }),
    );
  } catch {
    // Private mode: it just won't count offline.
  }
}

// ---- turning it on and off ----

/**
 * Count `userId` from now on, sending to `config`'s Umami (or, with no
 * config, stop). Events made before this was known are queued or dropped.
 */
export function setAnalytics(config, userId = null) {
  const on = Boolean(config?.umamiUrl && config?.umamiWebsiteId && userId);
  decided = true;
  target = on ? { umamiUrl: config.umamiUrl, umamiWebsiteId: config.umamiWebsiteId, userId } : null;
  const waiting = undecided;
  undecided = [];
  if (!on) return Promise.resolve();
  remember(userId, config);
  return Promise.all(waiting.map(queue)).then(flush);
}

/**
 * Not known yet whether `userId` is counted (signed in, the server not heard
 * from): hold events in memory until setAnalytics or forgetAnalytics says.
 */
export function awaitAnalytics(userId) {
  if (target?.userId === userId) return;
  target = null;
  decided = false;
}

/**
 * This person isn't counted (any more): forget their remembered switch and
 * drop whatever of theirs is still waiting. Signing out does this too.
 */
export async function forgetAnalytics(userId) {
  if (target?.userId === userId) target = null;
  decided = true;
  undecided = [];
  try {
    localStorage.removeItem(SETTINGS_KEY(userId));
  } catch {
    // nothing remembered
  }
  await safely(async () => {
    const mine = (await entries(db())).filter(([k]) => String(k).startsWith(`${userId}:`));
    await Promise.all(mine.map(([k]) => del(k, db())));
  });
}

// ---- the queue ----

function queue(event) {
  if (!target) return Promise.resolve();
  seq += 1;
  // Sorts in the order things happened, within this user's events.
  const key = `${target.userId}:${String(Date.now()).padStart(15, "0")}-${String(seq).padStart(6, "0")}`;
  return safely(() => set(key, { ...event, website: target.umamiWebsiteId }, db()));
}

function record(event) {
  const stamped = { ...event, timestamp: now() };
  if (!decided) {
    if (undecided.length < MAX_UNDECIDED) undecided.push(stamped);
    return;
  }
  if (!target) return;
  queue(stamped).then(flush);
}

/** This user's waiting events, oldest first, the old and the overflow dropped. */
async function waiting(userId) {
  const all = (await entries(db()))
    .filter(([k]) => String(k).startsWith(`${userId}:`))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const tooOld = now() - MAX_AGE_S;
  const stale = all.filter(([, e], i) => e.timestamp < tooOld || i < all.length - MAX_QUEUED);
  await Promise.all(stale.map(([k]) => del(k, db())));
  return all.filter((entry) => !stale.includes(entry));
}

async function sendOne(url, payload) {
  try {
    const response = await fetch(`${url}/api/send`, {
      method: "POST",
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "event", payload }),
    });
    // Any answer but a server error: done with it (a refusal won't change).
    return response.status < 500;
  } catch {
    return false; // no connection: keep it
  }
}

/**
 * Hold sending (events still queue) while "Use saved copies only" is on;
 * letting go sends what waited.
 */
export function holdAnalytics(on) {
  held = on;
  return on ? Promise.resolve() : flush();
}

/** Send what's waiting, oldest first; stop at the first that can't go. */
export function flush({ force = false } = {}) {
  if (!target || (held && !force)) return Promise.resolve();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve();
  if (flushing) return flushing;
  const { umamiUrl, userId } = target;
  flushing = safely(async () => {
    for (const [key, payload] of await waiting(userId)) {
      if (target?.userId !== userId) break; // signed out, or turned off
      if (!(await sendOne(umamiUrl, payload))) break;
      await del(key, db());
    }
  }).finally(() => {
    flushing = null;
  });
  return flushing;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flush();
  });
}

// ---- what the app tracks ----

function base({ url, title, role }) {
  return {
    hostname: window.location.hostname,
    language: navigator.language,
    screen: `${window.screen.width}x${window.screen.height}`,
    url,
    ...(title && { title }),
    tag: role,
  };
}

/** A page view: `url` and `title` are the page's name (pages.js), never its address. */
export function trackPageView({ url, title, role }) {
  const event = { ...base({ url, title, role }), data: { role } };
  // Where the visit came from, once a load, and only from outside the app
  // (an address inside it has ids in it).
  if (!sentReferrer) {
    sentReferrer = true;
    const from = document.referrer;
    if (from && !from.startsWith(window.location.origin)) event.referrer = from;
  }
  record(event);
}

/** A named event (a Trip tool used), with the role and any details. */
export function trackEvent(name, { url, role, ...data } = {}) {
  record({ ...base({ url, role }), name, data: { role, ...data } });
}

/** For tests: back to a fresh load, with nothing queued. */
export async function resetAnalyticsForTests() {
  decided = false;
  target = null;
  undecided = [];
  flushing = null;
  sentReferrer = false;
  held = false;
  await safely(async () => {
    const all = await entries(db());
    await Promise.all(all.map(([k]) => del(k, db())));
  });
}
