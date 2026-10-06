/**
 * The All trips countdown: how long until a trip's first day begins —
 * midnight at the start of `startDate` on the phone's own clock (for the
 * Okinawa trip, 12:00 AM Oct 29 wherever the phone is: half an hour before
 * the 12:30 AM flight out of Chicago).
 *
 * One unit at a time, rounded down: days while 24 hours or more remain, then
 * hours, then minutes, then "Starting now" in the last minute. Null once it
 * has begun.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Local midnight at the start of a "YYYY-MM-DD" date, as epoch ms. */
export function startOfDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"} to go`;

export function countdownLabel(startDate, now = Date.now()) {
  const left = startOfDay(startDate) - now;
  if (left <= 0) return null;
  if (left < MINUTE) return "Starting now";
  if (left < HOUR) return plural(Math.floor(left / MINUTE), "minute");
  if (left < DAY) return plural(Math.floor(left / HOUR), "hour");
  return plural(Math.floor(left / DAY), "day");
}
