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

const parts = (n, word) => ({ value: n, unit: `${word}${n === 1 ? "" : "s"} to go` });

/**
 * The countdown in two parts, for the card's large number over a small
 * unit: `{ value: 23, unit: "days to go" }`, or `{ value: null, unit:
 * "Starting now" }` in the last minute. Null once it has begun.
 */
export function countdownParts(startDate, now = Date.now()) {
  const left = startOfDay(startDate) - now;
  if (left <= 0) return null;
  if (left < MINUTE) return { value: null, unit: "Starting now" };
  if (left < HOUR) return parts(Math.floor(left / MINUTE), "minute");
  if (left < DAY) return parts(Math.floor(left / HOUR), "hour");
  return parts(Math.floor(left / DAY), "day");
}

/** The countdown as one line ("23 days to go"). */
export function countdownLabel(startDate, now = Date.now()) {
  const p = countdownParts(startDate, now);
  if (!p) return null;
  return p.value == null ? p.unit : `${p.value} ${p.unit}`;
}
