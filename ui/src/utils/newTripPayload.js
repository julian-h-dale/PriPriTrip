import dayjs from 'dayjs';

/**
 * Pure helpers for the New Trip wizard payload. Kept out of the page
 * component so they can be unit-tested (and so the page file only exports
 * a component, keeping react-refresh happy).
 */

export function ordinalDay(dateStr) {
  const d = dayjs(dateStr);
  const day = d.date();
  const suffix = ['th', 'st', 'nd', 'rd'][
    day % 10 < 4 && (day < 11 || day > 13) ? day % 10 : 0
  ];
  return d.format('MMMM') + ' ' + day + suffix;
}

export function buildDays(startDate, endDate) {
  const days = [];
  let current = dayjs(startDate);
  const last = dayjs(endDate);
  for (let i = 1; !current.isAfter(last, 'day'); i += 1) {
    days.push({
      dayId: crypto.randomUUID(),
      title: `Day ${i} — ${ordinalDay(current.format('YYYY-MM-DD'))}`,
      date: current.format('YYYY-MM-DD'),
      points: [],
    });
    current = current.add(1, 'day');
  }
  return days;
}

export function routeLocations(route) {
  if (!route) return [];
  return route.split(/[→\-–>]+/).map((part, i, arr) => ({
    locationId: crypto.randomUUID(),
    name: part.trim(),
    role: i === 0 ? 'origin' : i === arr.length - 1 ? 'destination' : 'waypoint',
  }));
}

/**
 * Convert a wizard leg into a trip-level travel detail plus generated
 * departure/arrival points, mirroring the backend's detail_points shape
 * (isSystemCreated: true so later detail syncs adopt these points).
 * Points are pushed onto the matching day in `days` (mutated in place).
 */
export function buildTravelLeg({ leg, days, fallbackDay }) {
  if (!leg || leg.skipped) return null;
  const travelDetailId = crypto.randomUUID();
  const name = leg.title || leg.route || 'Travel';

  const events = [
    ['departure', 'Departure', leg.departureDateTime],
    ['arrival', 'Arrival', leg.arrivalDateTime],
  ];
  for (const [type, label, dateTime] of events) {
    if (!dateTime) continue;
    const day = days.find((d) => d.date === dateTime.slice(0, 10)) ?? fallbackDay;
    if (!day) continue;
    day.points.push({
      pointId: crypto.randomUUID(),
      dayId: day.dayId,
      type,
      title: `${label}: ${name}`,
      travelDetailId,
      startDateTime: dateTime,
      endDateTime: dateTime,
      isSystemCreated: true,
      locations: [],
    });
  }

  return {
    travelDetailId,
    name,
    mode: leg.mode,
    operator: leg.operator || null,
    vehicleNumber: leg.vehicleNumber || null,
    departureDateTime: leg.departureDateTime || null,
    arrivalDateTime: leg.arrivalDateTime || null,
    locations: routeLocations(leg.route),
  };
}

export function buildImportPayload({ tripDetails, outbound, returnLeg }) {
  const tripId = crypto.randomUUID();
  const days = buildDays(tripDetails.startDate, tripDetails.endDate);

  const travels = [
    buildTravelLeg({ leg: outbound, days, fallbackDay: days[0] }),
    buildTravelLeg({ leg: returnLeg, days, fallbackDay: days[days.length - 1] }),
  ].filter(Boolean);

  return {
    tripId,
    tripName: tripDetails.tripName,
    startDate: tripDetails.startDate,
    endDate: tripDetails.endDate,
    stays: [],
    travels,
    days,
  };
}
