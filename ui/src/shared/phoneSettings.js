import { useSyncExternalStore } from "react";

/**
 * Trip settings kept on this phone only (Run stage 29), set under "On this
 * phone" on the Trip settings page: which screen a trip opens on, miles or
 * kilometres, and how far "Nearby" reaches. Nothing here goes to the server.
 *
 * Saved in localStorage: `openOn` and `nearbyRadius` as `{ [tripId]: … }`,
 * `distanceUnit` as "km" (miles when unset).
 */
const listeners = new Set();
const memory = new Map(); // when storage throws (private mode): until the app closes

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The raw stored string, re-rendering when any of these settings changes. */
function useRaw(key) {
  return useSyncExternalStore(subscribe, () => readRaw(key), () => null);
}

function parseObject(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function setForTrip(key, tripId, value) {
  const all = parseObject(readRaw(key));
  all[tripId] = value;
  writeRaw(key, JSON.stringify(all));
}

// ---- Distances: miles or kilometres, for every trip ----

export const DISTANCE_UNITS = [
  { key: "mi", label: "Miles" },
  { key: "km", label: "Kilometres" },
];

export function distanceUnit(raw = readRaw("distanceUnit")) {
  return raw === "km" ? "km" : "mi";
}

export function setDistanceUnit(unit) {
  writeRaw("distanceUnit", unit === "km" ? "km" : null);
}

export function useDistanceUnit() {
  return distanceUnit(useRaw("distanceUnit"));
}

const METRES_PER_MILE = 1609.344;

/** "0.3 mi" / "<0.1 mi", or "450 m" / "<10 m" / "1.2 km". */
export function distanceLabel(metres, unit) {
  if (unit === "km") {
    if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
    const rounded = Math.round(metres / 10) * 10;
    return rounded < 10 ? "<10 m" : `${rounded} m`;
  }
  const miles = metres / METRES_PER_MILE;
  return miles < 0.05 ? "<0.1 mi" : `${miles.toFixed(1)} mi`;
}

// ---- Which screen a trip opens on ----

export const OPEN_ON = [
  { key: "today", label: "Today" },
  { key: "timeline", label: "Timeline" },
  { key: "map", label: "Map" },
];

/** "today" | "timeline" | "map", or null when this phone hasn't chosen. */
export function openOn(tripId, raw = readRaw("openOn")) {
  const choice = parseObject(raw)[tripId];
  return OPEN_ON.some((o) => o.key === choice) ? choice : null;
}

export function setOpenOn(tripId, key) {
  setForTrip("openOn", tripId, key);
}

export function useOpenOn(tripId) {
  return openOn(tripId, useRaw("openOn"));
}

// ---- How far "Nearby" reaches, per trip ----

export const RADIUS_STEPS = {
  mi: [
    { metres: METRES_PER_MILE / 4, label: "¼ mi" },
    { metres: METRES_PER_MILE / 2, label: "½ mi" },
    { metres: METRES_PER_MILE, label: "1 mi" },
    { metres: METRES_PER_MILE * 2, label: "2 mi" },
  ],
  km: [
    { metres: 500, label: "0.5 km" },
    { metres: 1000, label: "1 km" },
    { metres: 2000, label: "2 km" },
    { metres: 3000, label: "3 km" },
  ],
};

/** Half a mile, a short walk (Run stage 27's radius). */
export const DEFAULT_RADIUS = METRES_PER_MILE / 2;

const isStep = (metres) => [...RADIUS_STEPS.mi, ...RADIUS_STEPS.km].some((s) => Math.abs(s.metres - metres) < 1);

/**
 * The radius step (`{ metres, label }`) Nearby uses for this trip, in
 * `unit`. A radius saved in the other unit becomes the nearest step in this
 * one; anything that isn't a step reads as the default.
 */
export function nearbyRadius(tripId, unit, raw = readRaw("nearbyRadius")) {
  const saved = Number(parseObject(raw)[tripId]);
  const metres = isStep(saved) ? saved : DEFAULT_RADIUS;
  const steps = RADIUS_STEPS[unit] ?? RADIUS_STEPS.mi;
  return steps.reduce((best, s) => (Math.abs(s.metres - metres) < Math.abs(best.metres - metres) ? s : best));
}

export function setNearbyRadius(tripId, metres) {
  setForTrip("nearbyRadius", tripId, metres);
}

export function useNearbyRadius(tripId) {
  const unit = useDistanceUnit();
  return nearbyRadius(tripId, unit, useRaw("nearbyRadius"));
}
