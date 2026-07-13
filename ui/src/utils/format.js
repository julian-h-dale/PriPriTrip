/**
 * Shared formatting helpers (review.md 2C-1).
 *
 * These were copy-pasted across pages and forms — localityLabel in four files,
 * firstLocationByRole in three, the datetime-local slice in three. One home now.
 */

import dayjs, { parseWallClock } from './dayjs';

const EM_DASH = '—';

function addressParts(location) {
  return (location?.fullAddress ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * What to call this place: "Houston Bush Airport", "Brother's Pizzeria".
 *
 * This is the location's own name, which is what a traveller recognises. The
 * previous helper showed the last two parts of the full address instead, which
 * reads fine for a city hotel ("Okinawa, Japan") and turns an airport into its
 * post code — "IL 60666, USA". Every caller wanted the name.
 */
export function placeLabel(location) {
  return location?.name || addressParts(location)[0] || EM_DASH;
}

/**
 * Where in the world that place is: "Naha, Okinawa, Japan" -> "Okinawa, Japan".
 * A secondary line under placeLabel; null when there is no address to reduce.
 */
export function placeLocality(location) {
  const parts = addressParts(location);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
}

export function firstLocationByRole(locations, role) {
  return (locations ?? []).find((loc) => loc.role === role) || null;
}

/** "Oct 30, 2026" */
export function formatDate(value, fallback = EM_DASH) {
  if (!value) return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format('MMM D, YYYY') : fallback;
}

/** "Oct 30, 2026 2:15 PM" — wall-clock, no timezone conversion. */
export function formatDateTime(value, fallback = EM_DASH) {
  if (!value) return fallback;
  const d = parseWallClock(value);
  return d.isValid() ? d.format('MMM D, YYYY h:mm A') : fallback;
}

/** "Oct 30, 2026 - Nov 5, 2026" */
export function formatDateRange(start, end, fallback = EM_DASH) {
  const startDt = start ? parseWallClock(start) : null;
  const endDt = end ? parseWallClock(end) : null;
  const startText = startDt?.isValid() ? startDt.format('MMM D, YYYY') : fallback;
  const endText = endDt?.isValid() ? endDt.format('MMM D, YYYY') : fallback;
  return `${startText} - ${endText}`;
}

/** "October 30th" */
export function formatDateOrdinal(dateStr) {
  const d = dayjs(dateStr);
  const day = d.date();
  const suffix = ['th', 'st', 'nd', 'rd'][
    day % 10 < 4 && (day < 11 || day > 13) ? day % 10 : 0
  ];
  return `${d.format('MMMM')} ${day}${suffix}`;
}

/** ISO string -> the "YYYY-MM-DDTHH:mm" an <input type="datetime-local"> wants. */
export function toDateTimeLocal(value) {
  if (!value) return '';
  return value.slice(0, 16);
}

/**
 * Ascending comparator on a date field; items missing/invalid dates sort last.
 * Usage: [...stays].sort(byDateAsc('checkIn'))
 */
export function byDateAsc(key) {
  const timeOf = (item) => {
    const value = item?.[key];
    const d = value ? dayjs(value) : null;
    return d?.isValid() ? d.valueOf() : Number.MAX_SAFE_INTEGER;
  };
  return (a, b) => timeOf(a) - timeOf(b);
}
