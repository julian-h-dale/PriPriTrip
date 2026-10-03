import { buildTimeline } from "@/features/timeline/buildTimeline";
import { stayCoverage } from "@/features/timeline/coverageView";
import { describeEntry } from "@/features/timeline/describeEntry";
import { datePart } from "@/shared/utils/time";
import { isInTrip, todayIn, wallToInstant } from "@/shared/utils/tripDates";

/**
 * What the Today tab shows, worked out from the trip alone. Pure, so it's
 * tested without rendering.
 */

/**
 * The day the Today tab is about: today on the trip's own calendar while the
 * trip is under way (`active`), otherwise its first day — a preview, so the
 * tab can be tried before the trip starts.
 */
export function referenceDay(trip, now = new Date()) {
  const today = todayIn(trip.timezone, now);
  return isInTrip(trip, today) ? { date: today, active: true } : { date: trip.startDate, active: false };
}

/**
 * The next thing with a time: a stay's check-in or check-out, a travel
 * departure, or a timed activity. Each is compared as a real instant on its
 * own place's clock, so a flight leaving Chicago and a dinner in Tokyo order
 * correctly. While active, "next" means at or after `now`; in the preview,
 * from the start of the first day.
 *
 * Returns { entry, date, instant } or null when nothing is left.
 */
export function nextUp(trip, ref, now = new Date()) {
  const from = ref.active ? now.getTime() : wallToInstant(`${ref.date}T00:00`, trip.timezone);
  let best = null;
  for (const row of buildTimeline(trip)) {
    for (const entry of row.entries) {
      if (entry.kind === "travel" && entry.phase === "arrive") continue; // the departure is the booking
      const d = describeEntry(entry, trip);
      if (!d.start) continue;
      const instant = wallToInstant(d.start, d.zone);
      if (instant < from) continue;
      if (!best || instant < best.instant) best = { entry, date: row.date, instant };
    }
  }
  return best;
}

/**
 * Where you sleep the night of `date` (`stay`), and a different stay you
 * check out of that morning (`checkingOut`), if any — a changeover day.
 */
export function tonight(trip, date) {
  const stay = stayCoverage(trip).get(date)?.stay ?? null;
  const checkingOut = (trip.stays ?? []).find((s) => datePart(s.checkOut) === date && s !== stay) ?? null;
  return { stay, checkingOut };
}

/** "in 25 min", "in 3 h 10 min", "in 2 days" — how long until an instant. */
export function untilLabel(instant, now) {
  const minutes = Math.floor((instant - now) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  const days = Math.round(minutes / (24 * 60));
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
