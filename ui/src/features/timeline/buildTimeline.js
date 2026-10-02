import { addDays, datePart, datesInRange } from "@/shared/utils/time";

/**
 * Turn a trip document into the rows the timeline renders.
 *
 * Bookings (stays, travels) live at trip level; days hold only activities.
 * The markers that put bookings on the timeline — check in / staying /
 * check out, depart / arrive — are computed here, at render time, and never
 * stored (docs/lessons_learned.md §2: stored derived points drift).
 *
 * Rules (implementation_plan.md, "Day view composition"):
 * - Every date from startDate to endDate gets a row, extended to cover a
 *   check-out or arrival on the day after the trip.
 * - Activities keep their document order. A timed marker goes just before the
 *   first timed activity starting at or after it; untimed activities stay
 *   attached to whatever precedes them. "Staying at" markers go first.
 * - Markers at the same time: check-out, depart, arrive, check-in.
 *
 * Wall-clock values are compared as strings: both sides are local times at
 * the place they happen, which is how a reader orders their day.
 */

const PHASE_RANK = { "check-out": 0, depart: 1, arrive: 2, "check-in": 3 };

/** Comparable key for a wall-clock value ("…T14:00" and "…T14:00:00" agree). */
function clockKey(value) {
  return value.length === 16 ? `${value}:00` : value;
}

function compareMarkers(a, b) {
  const byTime = clockKey(a.time).localeCompare(clockKey(b.time));
  return byTime !== 0 ? byTime : PHASE_RANK[a.phase] - PHASE_RANK[b.phase];
}

function stayMarkers(stays) {
  const markers = [];
  stays.forEach((stay, i) => {
    const inDate = datePart(stay.checkIn);
    const outDate = datePart(stay.checkOut);
    markers.push({ kind: "stay", phase: "check-in", key: `stay-${i}-in`, date: inDate, time: stay.checkIn, stay });
    for (let d = addDays(inDate, 1); d < outDate; d = addDays(d, 1)) {
      markers.push({ kind: "stay", phase: "staying", key: `stay-${i}-${d}`, date: d, time: null, stay });
    }
    markers.push({ kind: "stay", phase: "check-out", key: `stay-${i}-out`, date: outDate, time: stay.checkOut, stay });
  });
  return markers;
}

function travelMarkers(travels) {
  const markers = [];
  travels.forEach((travel, i) => {
    const departDate = datePart(travel.depart);
    // A leg that lands on a later date also shows on the day it lands.
    const overnight = Boolean(travel.arrive) && datePart(travel.arrive) > departDate;
    markers.push({ kind: "travel", phase: "depart", key: `travel-${i}-dep`, date: departDate, time: travel.depart, travel, overnight });
    if (overnight) {
      markers.push({ kind: "travel", phase: "arrive", key: `travel-${i}-arr`, date: datePart(travel.arrive), time: travel.arrive, travel, overnight });
    }
  });
  return markers;
}

/** Merge a day's activities (document order) with its markers (by time). */
function composeDay(items, markers) {
  const staying = markers.filter((m) => m.phase === "staying");
  const pending = markers.filter((m) => m.phase !== "staying").sort(compareMarkers);
  const entries = [...staying];
  items.forEach((item, j) => {
    if (item.start) {
      while (pending.length && clockKey(pending[0].time) <= clockKey(item.start)) {
        entries.push(pending.shift());
      }
    }
    entries.push({ kind: "activity", key: `item-${j}`, time: item.start ?? null, item });
  });
  return entries.concat(pending);
}

export function buildTimeline(trip) {
  const markers = [...stayMarkers(trip.stays ?? []), ...travelMarkers(trip.travels ?? [])];
  const daysByDate = new Map((trip.days ?? []).map((day) => [day.date, day]));

  // Extend past endDate only as far as a marker actually lands (check-out or
  // arrival the morning after the trip).
  const lastDate = markers.reduce((last, m) => (m.date > last ? m.date : last), trip.endDate);

  return datesInRange(trip.startDate, lastDate).map((date) => {
    const day = daysByDate.get(date) ?? null;
    const entries = composeDay(
      day?.items ?? [],
      markers.filter((m) => m.date === date)
    );
    return {
      date,
      title: day?.title ?? null,
      summary: day?.summary ?? null,
      afterTrip: date > trip.endDate,
      entries,
    };
  });
}
