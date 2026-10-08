/**
 * Date lookups relative to a trip: where "today" is, whether a date falls in
 * the trip, and the trip's phase. One place for these so today-aware features
 * (offline caching now; "what's next" later) agree with each other.
 *
 * Dates are plain "YYYY-MM-DD" strings, compared as strings (see time.js).
 * "Today" is a calendar day in a named IANA zone — usually the trip's own —
 * never the phone's clock read as UTC.
 */

import { addDays } from "@/shared/utils/time";

/** Today's date ("YYYY-MM-DD") in `timeZone` (default: the device's zone). */
export function todayIn(timeZone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True when `date` is one of the trip's days (start and end inclusive). */
export function isInTrip(trip, date) {
  return Boolean(date) && date >= trip.startDate && date <= trip.endDate;
}

/** "upcoming" | "active" | "past", judged by the trip's own calendar. */
export function tripPhase(trip, now = new Date()) {
  const today = todayIn(trip.timezone, now);
  if (today < trip.startDate) return "upcoming";
  if (today > trip.endDate) return "past";
  return "active";
}

/**
 * Where a trip opens (Run stage 21): its Today for an owner or editor while
 * it's active or still to come (before it starts, Today previews Day 1); its
 * timeline for a past trip (nothing is "today" any more) and for a viewer,
 * who has no Today tab.
 */
export function tripHomePath(trip, now = new Date()) {
  const timeline = `/trips/${trip.id}`;
  if (trip.role === "viewer" || tripPhase(trip, now) === "past") return timeline;
  return `${timeline}/today`;
}

/**
 * Which date a new entry's form should open on, when nothing more specific
 * says (e.g. adding from the map):
 *   1. `preferred` (e.g. the map's day filter), when it's inside the trip;
 *   2. today on the trip's calendar, when the trip is under way;
 *   3. the first trip date `skip` doesn't rule out (for a stay: the first
 *      night with no stay yet);
 *   4. the trip's first day.
 * Always editable in the form afterwards.
 */
export function defaultFormDate(trip, { preferred, skip, now = new Date() } = {}) {
  if (isInTrip(trip, preferred)) return preferred;
  const today = todayIn(trip.timezone, now);
  if (isInTrip(trip, today)) return today;
  if (skip) {
    for (let d = trip.startDate; d <= trip.endDate; d = addDays(d, 1)) {
      if (!skip(d)) return d;
    }
  }
  return trip.startDate;
}

/**
 * Trips (anything with startDate/endDate/timezone) by phase, each in the
 * order it's listed: active and upcoming soonest first, past most recent
 * first.
 */
export function groupTrips(trips, now = new Date()) {
  const groups = { active: [], upcoming: [], past: [] };
  for (const trip of trips) groups[tripPhase(trip, now)].push(trip);
  const byStart = (a, b) => a.startDate.localeCompare(b.startDate);
  groups.active.sort(byStart);
  groups.upcoming.sort(byStart);
  groups.past.sort((a, b) => b.endDate.localeCompare(a.endDate));
  return groups;
}

/** The trip the app opens on: the active one, else the next upcoming one, else null. */
export function pickLandingTrip(trips, now = new Date()) {
  const { active, upcoming } = groupTrips(trips, now);
  return active[0] ?? upcoming[0] ?? null;
}

/** How far `zone` is ahead of UTC at the instant `utcMs`, in ms. */
function zoneOffsetMs(zone, utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - utcMs;
}

/**
 * The instant (UTC ms) a wall-clock value ("2026-10-29T10:35") happens in
 * `zone` — only for *comparing* times written on different clocks (e.g.
 * "what's next" across a flight's two zones). Never for display: trip times
 * render exactly as written (time.js).
 */
export function wallToInstant(wall, zone) {
  const [date, time = "00:00"] = wall.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - zoneOffsetMs(zone, guess);
  // Re-check at the corrected instant, in case a DST change sits in between.
  return guess - zoneOffsetMs(zone, first);
}
