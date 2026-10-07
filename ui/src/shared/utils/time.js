/**
 * Date and wall-clock formatting for trip content.
 *
 * Trip times are wall-clock values ("2026-05-11T14:00") — what the ticket says,
 * in the place it happens. They must render exactly as written, whatever the
 * viewer's timezone. So nothing here builds a local `Date` from them or calls
 * `dayjs(isoString)` (v1 did, and the same event showed different times on
 * different pages — see docs/lessons_learned.md §3). Plain dates use UTC
 * arithmetic only, which has no DST or zone to shift them.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-05-11" -> { y, m, d } (m is 1-based). */
function splitDate(dateStr) {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function toUtcMs(dateStr) {
  const { y, m, d } = splitDate(dateStr);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The date part of a wall-clock value or a plain date. */
export function datePart(value) {
  return value.slice(0, 10);
}

/** Plain-date arithmetic: addDays("2026-05-31", 1) -> "2026-06-01". */
export function addDays(dateStr, days) {
  return fromUtcMs(toUtcMs(dateStr) + days * 86_400_000);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** Every date from start to end inclusive. */
export function datesInRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "2026-05-11T14:00" -> "2:00 PM". */
export function formatTime(wallClock) {
  const [hh, mm] = wallClock.slice(11, 16).split(":").map(Number);
  const suffix = hh < 12 ? "AM" : "PM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** "2026-05-11" -> "Mon, May 11". */
export function formatDayHeading(dateStr) {
  const { m, d } = splitDate(dateStr);
  return `${formatWeekday(dateStr)}, ${MONTHS[m - 1]} ${d}`;
}

/** "2026-05-11" -> "Mon". */
export function formatWeekday(dateStr) {
  return WEEKDAYS[new Date(toUtcMs(dateStr)).getUTCDay()];
}

/** "2026-05-11" -> "May 11". */
export function formatShortDate(dateStr) {
  const { m, d } = splitDate(dateStr);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "May 10 – 14, 2026", "Apr 30 – May 2, 2026", "Dec 30, 2026 – Jan 2, 2027". */
export function formatDateRange(start, end) {
  const a = splitDate(start);
  const b = splitDate(end);
  if (a.y !== b.y) {
    return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  }
  if (a.m === b.m) {
    return a.d === b.d
      ? `${MONTHS[a.m - 1]} ${a.d}, ${a.y}`
      : `${MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${a.y}`;
  }
  return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`;
}

/** A leg's length from the server's `durationMinutes`: "45m", "2h 5m",
 * "13h 50m"; days only past 24 hours ("1d 2h"). Null when unknown. */
export function formatDuration(minutes) {
  if (minutes == null || minutes < 0) return null;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/** "America/Chicago" -> "Chicago", "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
export function zoneLabel(timezone) {
  return timezone.split("/").pop().replaceAll("_", " ");
}

const SAVED_AT = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/**
 * An instant (ISO with offset/Z) in the phone's own zone, e.g. "Oct 3, 2:14 PM"
 * — for when this device saved something, never for trip wall-clock times.
 */
export function formatSavedAt(iso) {
  return new Intl.DateTimeFormat(undefined, SAVED_AT).format(new Date(iso));
}

/**
 * How long ago an instant (ISO with offset/Z) was, as a phrase that follows a
 * verb: "just now", "2 minutes ago", "3 hours ago", else "on Oct 3, 2:14 PM".
 */
export function formatAgo(iso, now = Date.now()) {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `on ${formatSavedAt(iso)}`;
}
