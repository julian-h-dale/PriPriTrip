/**
 * Where you were on a trip's screens (Run stage 29): the timeline's view and
 * scroll, and later the map's. Leaving a screen remembers its place, coming
 * back puts you there again. Held in memory only, so a fresh start of the
 * app opens fresh (Q1), and so does opening a trip from the trips list.
 *
 * `screen` is "timeline" or "map"; a place is whatever that screen saves.
 */
const SCREENS = ["timeline", "map"];
const places = new Map(); // `${screen}:${tripId}` → place

export function rememberPlace(screen, tripId, place) {
  places.set(`${screen}:${tripId}`, place);
}

/** The place `screen` was left at on this trip, or null. */
export function savedPlace(screen, tripId) {
  return places.get(`${screen}:${tripId}`) ?? null;
}

/** Forget one screen's place, or every screen's for this trip. */
export function forgetPlaces(tripId, screen = null) {
  for (const s of screen ? [screen] : SCREENS) places.delete(`${s}:${tripId}`);
}
