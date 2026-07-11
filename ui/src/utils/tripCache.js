/**
 * IndexedDB cache for trip documents.
 *
 * Trips are stored keyed by tripId, and the trips list is stored under a
 * dedicated list key, so the timeline and the trips page are available
 * offline after the first successful network load (review 2C-6).
 */

const DB_NAME = 'pripritrip';
const DB_VERSION = 2;
const STORE = 'trip';
const TRIPS_LIST_KEY = '__trips__';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function put(value, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      })
  );
}

function get(key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = (e) => resolve(e.target.result ?? null);
        req.onerror = (e) => reject(e.target.error);
      })
  );
}

export async function cacheTrip(trip) {
  if (!trip?.tripId) return;
  await put(trip, trip.tripId);
}

export async function getCachedTrip(tripId) {
  if (!tripId) return null;
  return get(tripId);
}

export async function cacheTripList(trips) {
  if (!Array.isArray(trips)) return;
  await put(trips, TRIPS_LIST_KEY);
}

export async function getCachedTripList() {
  return get(TRIPS_LIST_KEY);
}
