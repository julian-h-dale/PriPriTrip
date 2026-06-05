import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import advancedFormat from 'dayjs/plugin/advancedFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

// Parse wall-clock time from an ISO string (e.g. "2026-05-11T12:15:00+01:00" → 12:15).
// Strips the offset so dayjs treats it as a plain local time — no timezone conversion.
export function parseWallClock(isoString) {
  if (!isoString) return null;
  return dayjs(isoString.slice(0, 19));
}

export default dayjs;
