import { describeEntry } from "@/features/timeline/describeEntry";
import { todayIn, wallToInstant } from "@/shared/utils/tripDates";

/**
 * Whether a day's entry has already happened (Run stage 30), so the day page
 * and Today can grey it out. Times are judged as real instants on each
 * entry's own place's clock (falling back to the trip's zone), as "Next up"
 * does, so the phone's own zone doesn't matter:
 *
 * - an entry with an end (an activity's end, a same-day leg's arrival) is
 *   done once that has passed;
 * - otherwise once its time has started (an activity with only a start,
 *   check-in, check-out, an overnight departure, an arrival);
 * - an untimed activity, or "Staying at", once its day is over on the
 *   trip's calendar.
 *
 * A timed entry goes by its own time only, never by the day: a flight home
 * that lands in Chicago after midnight in Athens is still in the air.
 *
 * `date` is the timeline row's date; `now` is ms since the epoch.
 */
export function isDone(entry, date, trip, now = Date.now()) {
  const d = describeEntry(entry, trip);
  if (!d.start) return date < todayIn(trip.timezone, new Date(now));
  const instant = d.end ? wallToInstant(d.end, d.endZone ?? d.zone) : wallToInstant(d.start, d.zone);
  return instant < now;
}
