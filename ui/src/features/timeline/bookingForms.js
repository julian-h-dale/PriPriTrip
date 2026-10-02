import { compact, locationFrom, placeOf } from "@/features/timeline/activityForm";
import { addDays, datePart } from "@/shared/utils/time";

/**
 * Pure helpers behind StayForm and TravelForm. Users enter wall-clock dates
 * and times only; which clock they're on comes from the places (server-side,
 * app/zones.py), so nothing here deals with timezones.
 */

const CHECK_IN_TIME = "15:00";
const CHECK_OUT_TIME = "11:00";

function split(wallClock) {
  return wallClock ? [datePart(wallClock), wallClock.slice(11, 16)] : ["", ""];
}

function joined(date, time) {
  return date && time ? `${date}T${time}` : null;
}

// ---- stays ----

export const STAY_TYPES = [
  ["hotel", "Hotel"],
  ["airbnb", "Airbnb"],
  ["rental", "Rental"],
  ["hostel", "Hostel"],
  ["other", "Other"],
];

/** Form state for an existing stay, or a new one checking in on `date`. */
export function toStayValues(stay, date, trip) {
  const [checkInDate, checkInTime] = split(stay?.checkIn);
  const [checkOutDate, checkOutTime] = split(stay?.checkOut);
  const lastCheckOut = addDays(trip.endDate, 1);
  const nextDay = addDays(date, 1);
  return {
    name: stay?.name ?? "",
    type: stay?.type ?? "hotel",
    place: placeOf(stay?.location),
    locationUrl: stay?.location?.url ?? "",
    checkInDate: stay ? checkInDate : date,
    checkInTime: stay ? checkInTime : CHECK_IN_TIME,
    checkOutDate: stay ? checkOutDate : nextDay > lastCheckOut ? lastCheckOut : nextDay,
    checkOutTime: stay ? checkOutTime : CHECK_OUT_TIME,
    roomType: stay?.roomType ?? "",
    confirmationNumber: stay?.confirmationNumber ?? "",
    notes: stay?.notes ?? "",
  };
}

export function stayPayload(values, original) {
  return compact({
    name: values.name.trim(),
    type: values.type,
    checkIn: joined(values.checkInDate, values.checkInTime),
    checkOut: joined(values.checkOutDate, values.checkOutTime),
    timezone: original?.timezone ?? null, // import-only fallback, kept as-is
    location: locationFrom(values.place, values.locationUrl),
    roomType: values.roomType.trim() || null,
    confirmationNumber: values.confirmationNumber.trim() || null,
    notes: values.notes.trim() ? values.notes : null,
  });
}

export function validateStay(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Name the stay";
  if (!values.place) errors.place = "Pick where you’re staying — it sets the stay’s clock";
  else if (!values.place.name.trim()) errors.place = "Give the place a name";
  if (!values.checkInDate || !values.checkInTime) errors.checkIn = "Check-in date and time are required";
  if (!values.checkOutDate || !values.checkOutTime) {
    errors.checkOut = "Check-out date and time are required";
  } else if (
    !errors.checkIn &&
    joined(values.checkOutDate, values.checkOutTime) <= joined(values.checkInDate, values.checkInTime)
  ) {
    errors.checkOut = "Check-out must be after check-in";
  }
  return errors;
}

export const STAY_PATHS = {
  name: "name",
  type: "type",
  checkIn: "checkIn",
  checkOut: "checkOut",
  location: "place",
  "location.name": "place",
  "location.url": "locationUrl",
  roomType: "roomType",
  confirmationNumber: "confirmationNumber",
  notes: "notes",
};

// ---- travel ----

export const TRAVEL_MODES = [
  ["flight", "Fly"],
  ["train", "Train"],
  ["bus", "Bus"],
  ["ferry", "Ferry"],
  ["boat", "Boat"],
  ["car", "Car"],
  ["other", "Other"],
];

/** "Zürich Airport → Split" from the picked places (what the title defaults to). */
export function autoTitle(values) {
  const from = values.from?.name.trim();
  const to = values.to?.name.trim();
  if (from && to) return `${from} → ${to}`;
  return from ? `From ${from}` : "";
}

/** Form state for an existing leg, or a new one departing on `date`. */
export function toTravelValues(travel, date) {
  const [departDate, departTime] = split(travel?.depart);
  const [arriveDate, arriveTime] = split(travel?.arrive);
  const values = {
    mode: travel?.mode ?? "flight",
    title: travel?.title ?? "",
    carrier: travel?.carrier ?? "",
    number: travel?.number ?? "",
    seat: travel?.seat ?? "",
    from: placeOf(travel?.from),
    departDate: travel ? departDate : date,
    departTime,
    to: placeOf(travel?.to),
    arriveDate,
    arriveTime,
    confirmationNumber: travel?.confirmationNumber ?? "",
    notes: travel?.notes ?? "",
  };
  // A title that was never changed keeps following the places.
  values.titleEdited = Boolean(travel) && travel.title !== autoTitle(values);
  return values;
}

/** Why the arrival is incomplete (the timeline can't show the landing), or null. */
export function arrivalWarning(values) {
  if (!values.to) return "No arrival place yet";
  if (!values.arriveDate || !values.arriveTime) return "No arrival time yet";
  return null;
}

export function travelPayload(values, original) {
  const arrive = values.to ? joined(values.arriveDate, values.arriveTime) : null;
  return compact({
    title: values.title.trim() || autoTitle(values),
    mode: values.mode,
    carrier: values.carrier.trim() || null,
    number: values.number.trim() || null,
    seat: values.seat.trim() || null,
    from: locationFrom(values.from, ""),
    to: locationFrom(values.to, ""),
    depart: joined(values.departDate, values.departTime),
    arrive,
    // import-only fallbacks, kept as-is
    departTimezone: original?.departTimezone ?? null,
    arriveTimezone: original?.arriveTimezone ?? null,
    confirmationNumber: values.confirmationNumber.trim() || null,
    notes: values.notes.trim() ? values.notes : null,
  });
}

export function validateTravel(values) {
  const errors = {};
  if (!values.from) errors.from = "Pick where it leaves from — it sets the departure’s clock";
  else if (!values.from.name.trim()) errors.from = "Give the place a name";
  if (values.to && !values.to.name.trim()) errors.to = "Give the place a name";
  if (!values.departDate || !values.departTime) errors.depart = "Departure date and time are required";
  if (!values.title.trim() && !autoTitle(values)) errors.title = "Give the leg a title";
  if (values.to && Boolean(values.arriveDate) !== Boolean(values.arriveTime)) {
    errors.arrive = "Add both the arrival date and time, or neither";
  }
  return errors;
}

export const TRAVEL_PATHS = {
  title: "title",
  mode: "mode",
  carrier: "carrier",
  number: "number",
  seat: "seat",
  from: "from",
  to: "to",
  depart: "depart",
  arrive: "arrive",
  confirmationNumber: "confirmationNumber",
  notes: "notes",
};

/**
 * Where place search should look first: the trip's first stay with
 * coordinates, else any place on the trip that has them.
 */
export function biasPoint(trip) {
  const located = (loc) => loc && loc.lat != null && loc.lng != null;
  const candidates = [
    ...(trip.stays ?? []).map((s) => s.location),
    ...(trip.travels ?? []).flatMap((t) => [t.from, t.to]),
    ...(trip.days ?? []).flatMap((d) => d.items.map((i) => i.location)),
  ];
  const hit = candidates.find(located);
  return hit ? { lat: hit.lat, lng: hit.lng } : undefined;
}
