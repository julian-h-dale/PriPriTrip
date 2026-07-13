/**
 * What's next, and how long until it (docs/active_trip_plan.md).
 *
 * Two functions, because that is all the logic there is.
 *
 * The reason this stays small is `startUtc` / `endUtc`. A point's
 * `startDateTime` is a *wall clock* — "09:00", what the ticket says — and you
 * cannot compare a wall clock to `now` without knowing which clock it is on.
 * The backend already derived the instant, so we ask for it and compare numbers.
 * No timezones, no calendars, no day boundaries.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Every point on the trip, in time order. Points with no time sort last. */
function allPoints(trip) {
  return (trip?.days ?? [])
    .flatMap((day) => day.points ?? [])
    .filter((point) => point.startUtc)
    .sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));
}

/**
 * The one thing to put on screen.
 *
 * Something happening *right now* wins — you want the boarding pass while you're
 * boarding, not the next thing after it. Otherwise it's the earliest incomplete
 * point still ahead of you. Completed points are skipped, which is what makes
 * ticking one off advance the screen.
 *
 * Returns null when there is nothing left.
 */
export function nextPoint(trip, now = Date.now()) {
  const points = allPoints(trip).filter((point) => !point.completed);
  const at = now instanceof Date ? now.getTime() : now;

  const happening = points.find((point) => {
    const start = new Date(point.startUtc).getTime();
    const end = point.endUtc ? new Date(point.endUtc).getTime() : start;
    return start <= at && at <= end;
  });
  if (happening) return happening;

  return points.find((point) => new Date(point.startUtc).getTime() > at) ?? null;
}

/**
 * The points after `point`, in order. The "THEN" list — a flat list, no grouping.
 */
export function followingPoints(trip, point, limit = 4) {
  if (!point) return [];
  const points = allPoints(trip).filter((p) => !p.completed);
  const index = points.findIndex((p) => p.pointId === point.pointId);
  if (index === -1) return [];
  return points.slice(index + 1, index + 1 + limit);
}

/**
 * How long until something — and how much you should care.
 *
 * `urgency` drives the colour: the countdown going amber under an hour is the
 * cheapest thing that makes this screen feel alive rather than like a document.
 *
 * Returns { text, urgency } where urgency is 'now' | 'soon' | 'today' | 'later'.
 */
export function countdown(startUtc, now = Date.now(), endUtc = null) {
  if (!startUtc) return { text: '', urgency: 'later' };

  const at = now instanceof Date ? now.getTime() : now;
  const start = new Date(startUtc).getTime();
  const end = endUtc ? new Date(endUtc).getTime() : start;

  if (at >= start && at <= end) return { text: 'now', urgency: 'now' };

  const delta = start - at;
  if (delta < 0) return { text: 'passed', urgency: 'later' };

  if (delta < MINUTE) return { text: 'in under a minute', urgency: 'now' };
  if (delta < HOUR) {
    const mins = Math.round(delta / MINUTE);
    return { text: `in ${mins} min`, urgency: 'soon' };
  }
  if (delta < DAY) {
    // Round the minutes FIRST, then split. Flooring the hours and rounding the
    // remainder separately produced "in 4h 60m" — the rounding carried and
    // nobody was there to catch it.
    const totalMins = Math.round(delta / MINUTE);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const text = mins ? `in ${hours}h ${mins}m` : `in ${hours}h`;
    return { text, urgency: 'today' };
  }

  const days = Math.round(delta / DAY);
  return { text: `in ${days} ${days === 1 ? 'day' : 'days'}`, urgency: 'later' };
}

/**
 * "Be at the airport by…" — a static rule, not a routing API.
 *
 * Real door-to-door time needs Google Directions. This is the number a traveller
 * actually uses, and it costs nothing.
 *
 * Only for a DEPARTURE. An arrival is a thing that happens *to* you — telling
 * someone to be at the airport two hours before they land is nonsense, which is
 * exactly what it said until a screenshot caught it.
 */
export function leaveByHint(point) {
  if (point?.type !== 'departure') return null;

  const mode = point?.travelDetail?.mode;
  if (!mode || !point.startUtc) return null;

  const lead = { flight: 2 * HOUR, train: 20 * MINUTE, ferry: 45 * MINUTE, bus: 15 * MINUTE }[mode];
  if (!lead) return null;

  const place = mode === 'flight' ? 'the airport' : 'the station';
  return { at: new Date(new Date(point.startUtc).getTime() - lead), place };
}
