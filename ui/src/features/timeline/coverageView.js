import { addDays, datePart } from "@/shared/utils/time";

/**
 * A fixed, never-reassigned categorical color order (dataviz skill reference
 * palette, dark-surface slots — this app has no light theme). Identity comes
 * from the record's position, so the same stay/leg always gets the same
 * color across renders.
 */
const SERIES_CLASSES = [
  "bg-series-1",
  "bg-series-2",
  "bg-series-3",
  "bg-series-4",
  "bg-series-5",
  "bg-series-6",
  "bg-series-7",
  "bg-series-8",
];

function seriesClass(index) {
  return SERIES_CLASSES[index % SERIES_CLASSES.length];
}

/**
 * Which stay, if any, covers the *night* of each date: a stay covers date D
 * when its check-in date <= D < its check-out date. The first stay to claim
 * a date wins (overlapping stays aren't a case we verify here).
 */
export function stayCoverage(trip) {
  const byDate = new Map();
  (trip.stays ?? []).forEach((stay, i) => {
    const inDate = datePart(stay.checkIn);
    const outDate = datePart(stay.checkOut);
    for (let d = inDate; d < outDate; d = addDays(d, 1)) {
      if (!byDate.has(d)) byDate.set(d, { label: stay.name, colorClass: seriesClass(i), stay });
    }
  });
  return byDate;
}

/**
 * Which travel leg(s) touch each date: a leg's depart date, plus its arrival
 * date too when it lands on a later date. Unlike stays, two legs landing on
 * the same date is normal (e.g. a same-day connecting flight), so later legs
 * add their title to the date's label and their record to `travels` rather
 * than replacing it; the date keeps the color of whichever leg claimed it
 * first.
 */
export function travelCoverage(trip) {
  const byDate = new Map();
  (trip.travels ?? []).forEach((travel, i) => {
    const departDate = datePart(travel.depart);
    const dates = [departDate];
    if (travel.arrive && datePart(travel.arrive) > departDate) {
      dates.push(datePart(travel.arrive));
    }
    dates.forEach((d) => {
      const existing = byDate.get(d);
      if (existing) {
        existing.label = `${existing.label} · ${travel.title}`;
        existing.travels.push(travel);
      } else {
        byDate.set(d, { label: travel.title, colorClass: seriesClass(i), travels: [travel] });
      }
    });
  });
  return byDate;
}
