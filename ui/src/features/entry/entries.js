import { buildTimeline } from "@/features/timeline/buildTimeline";
import { datePart } from "@/shared/utils/time";

/**
 * An entry's own page (Run stage 13): one address per activity, stay and
 * travel leg, by its id, so Back, reloads and links all work.
 *
 *   /trips/:tripId/activities/:id   /trips/:tripId/stays/:id   /trips/:tripId/travel/:id
 */
export const ENTRY_SEGMENT = { activity: "activities", stay: "stays", travel: "travel" };

export function entryPath(tripId, kind, id) {
  return `/trips/${tripId}/${ENTRY_SEGMENT[kind]}/${id}`;
}

/** The page for a timeline entry (a row, a marker): its activity, stay or leg. */
export function entryPathFor(tripId, entry) {
  if (entry.kind === "activity") return entryPath(tripId, "activity", entry.item.id);
  if (entry.kind === "stay") return entryPath(tripId, "stay", entry.stay.id);
  return entryPath(tripId, "travel", entry.travel.id);
}

/**
 * The live record for a page, from the loaded trip: `{ kind, record, date }`
 * (`date`: the day it belongs to, where Back goes when there's no history),
 * or null when it isn't in the trip (deleted, or never was).
 */
export function findEntry(trip, kind, id) {
  if (kind === "activity") {
    for (const day of trip.days ?? []) {
      const item = day.items?.find((i) => i.id === id);
      if (item) return { kind, record: item, date: day.date };
    }
    return null;
  }
  if (kind === "stay") {
    const stay = trip.stays?.find((s) => s.id === id);
    return stay ? { kind, record: stay, date: datePart(stay.checkIn) } : null;
  }
  const travel = trip.travels?.find((t) => t.id === id);
  return travel ? { kind, record: travel, date: datePart(travel.depart) } : null;
}

/** The record a timeline entry opens: `{ kind, id }`. */
function recordOf(entry) {
  if (entry.kind === "activity") return { kind: "activity", id: entry.item.id };
  if (entry.kind === "stay") return { kind: "stay", id: entry.stay.id };
  return { kind: "travel", id: entry.travel.id };
}

/**
 * Every entry's page in timeline order (Run stage 14): one step per timeline
 * row, `{ kind, id, key, date, entry }`. "Staying at" rows are left out
 * (they're filler between check-in and check-out), and so is a row for the
 * same page as the row before it on the same day (a leg arriving the day it
 * left). A stay or leg can still come up twice: check-in and check-out, an
 * overnight leg's two ends, each on its own day. `key` tells them apart.
 */
export function entrySequence(trip) {
  const steps = [];
  for (const row of buildTimeline(trip)) {
    for (const entry of row.entries) {
      if (entry.phase === "staying") continue;
      const { kind, id } = recordOf(entry);
      const last = steps[steps.length - 1];
      if (last && last.date === row.date && last.kind === kind && last.id === id) continue;
      steps.push({ kind, id, key: entry.key, date: row.date, entry });
    }
  }
  return steps;
}

/**
 * Where a page is in `steps` (from entrySequence): `{ at, prev, next }`, the
 * page's own step and those either side **on the same day**, each null at
 * the day's first or last entry: moving never crosses into another day
 * (Julian, 2026-10-06: it isn't obvious enough that you've changed day). `atKey` (the row it was opened from) picks
 * which of a stay's or leg's rows it is; without it, or when that row isn't
 * one of the steps any more, it's the record's first.
 */
export function neighbours(steps, kind, id, atKey) {
  const mine = (s) => s.kind === kind && s.id === id;
  let i = atKey ? steps.findIndex((s) => s.key === atKey && mine(s)) : -1;
  if (i === -1) i = steps.findIndex(mine);
  if (i === -1) return { at: null, prev: null, next: null };
  const sameDay = (s) => (s && s.date === steps[i].date ? s : null);
  return { at: steps[i], prev: sameDay(steps[i - 1]), next: sameDay(steps[i + 1]) };
}
