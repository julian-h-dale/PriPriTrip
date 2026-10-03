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
