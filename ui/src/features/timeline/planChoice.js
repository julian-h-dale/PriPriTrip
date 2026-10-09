import { useSyncExternalStore } from "react";

/**
 * Which plan a day shows (Run stage 25): plan A unless someone switched that
 * day to its plan B on the day page. A choice for this phone only, nothing
 * is saved to the trip, and it lasts until switched back (Q-B1), so opening
 * an activity and coming Back keeps your place.
 *
 * Saved as `{ [tripId]: [date, …] }`, the days showing plan B.
 */
const KEY = "planB";
let fallback = "{}"; // when storage throws (private mode): until the app closes

function read() {
  try {
    return localStorage.getItem(KEY) ?? "{}";
  } catch {
    return fallback;
  }
}

function parse(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

const listeners = new Set();

/** Whether this phone shows `date`'s plan B (whether or not it has one). */
export function showsPlanB(tripId, date, raw = read()) {
  const dates = parse(raw)[tripId];
  return Array.isArray(dates) && dates.includes(date);
}

export function setShowsPlanB(tripId, date, on) {
  const all = parse(read());
  const dates = new Set(Array.isArray(all[tripId]) ? all[tripId] : []);
  if (on) dates.add(date);
  else dates.delete(date);
  if (dates.size) all[tripId] = [...dates].sort();
  else delete all[tripId];
  const raw = JSON.stringify(all);
  fallback = raw;
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, raw);
    else localStorage.removeItem(KEY);
  } catch {
    // Kept in `fallback` instead.
  }
  listeners.forEach((l) => l());
}

/**
 * Every choice, as a value that changes when one does: pass it to
 * `showsPlanB(tripId, date, choices)` and to memo dependencies.
 */
export function usePlanChoices() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "{}",
  );
}
