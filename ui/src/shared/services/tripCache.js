import { clear, createStore, del, get, keys, set } from "idb-keyval";

/**
 * The offline copy of a user's trips, in IndexedDB. Keyed by user id so a
 * second account on the same phone never reads the first one's trips:
 *
 *   trips:<userId>          { data: TripSummary[], savedAt }
 *   trip:<userId>:<tripId>  { data: TripRead, savedAt }
 *
 * `savedAt` is an ISO instant (when this phone last got it from the server).
 * Best-effort throughout: a browser without IndexedDB (private mode, tests)
 * just has no cache — every function resolves, never throws.
 */

let store;
function db() {
  store ??= createStore("pripritrip", "trips");
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

const listKey = (userId) => `trips:${userId}`;
const tripKey = (userId, tripId) => `trip:${userId}:${tripId}`;

export function readTripList(userId) {
  if (!userId) return Promise.resolve(null);
  return safely(() => get(listKey(userId), db()));
}

export function saveTripList(userId, data) {
  if (!userId) return Promise.resolve();
  return safely(() => set(listKey(userId), { data, savedAt: new Date().toISOString() }, db()));
}

export function readTrip(userId, tripId) {
  if (!userId) return Promise.resolve(null);
  return safely(() => get(tripKey(userId, tripId), db()));
}

export function saveTrip(userId, data) {
  if (!userId) return Promise.resolve();
  return safely(() => set(tripKey(userId, data.id), { data, savedAt: new Date().toISOString() }, db()));
}

export function removeTrip(userId, tripId) {
  if (!userId) return Promise.resolve();
  return safely(() => del(tripKey(userId, tripId), db()));
}

/** Forget everything cached for one user (on sign-out). */
export function clearUser(userId) {
  if (!userId) return Promise.resolve();
  return safely(async () => {
    const mine = (await keys(db())).filter(
      (k) => k === listKey(userId) || String(k).startsWith(`trip:${userId}:`)
    );
    await Promise.all(mine.map((k) => del(k, db())));
  });
}

/** Test helper: wipe the whole store. */
export function clearAll() {
  return safely(() => clear(db()));
}
