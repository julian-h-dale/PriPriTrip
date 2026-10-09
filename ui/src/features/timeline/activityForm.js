import { addDays, datePart } from "@/shared/utils/time";

/**
 * Pure helpers behind the hand-written forms: record <-> form values, client
 * checks, and server error paths -> form fields. Kept out of the components so
 * the rules are tested directly.
 */

/** A place as a form holds it: the location minus its link (edited separately). */
export function placeOf(location) {
  if (!location) return null;
  const place = { ...location };
  delete place.url;
  return place;
}

/** A place plus the link field back into a document location, or null. */
export function locationFrom(place, url) {
  if (!place) return null;
  const location = { ...place, name: place.name.trim() };
  for (const key of Object.keys(location)) {
    if (location[key] === undefined || location[key] === null || location[key] === "") {
      delete location[key];
    }
  }
  if (url.trim()) location.url = url.trim();
  return location;
}

/** Drop null fields: the API treats absent and null alike on a full replace. */
export function compact(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null));
}

/**
 * Form state for an existing activity (or a blank one on `date`). A new one can
 * start from `prefill.place` (e.g. picked on the map), titled after it.
 * `planB`: whether it is (or, new, starts) in the day's plan B.
 */
export function toFormValues(item, date, prefill, planB = false) {
  return {
    title: item?.title ?? (prefill?.place?.name || ""),
    date: item?.start ? datePart(item.start) : date,
    startTime: item?.start?.slice(11, 16) ?? "",
    endTime: item?.end?.slice(11, 16) ?? "",
    place: item ? placeOf(item.location) : (prefill?.place ?? null),
    locationUrl: item?.location?.url ?? "",
    confirmationNumber: item?.confirmationNumber ?? "",
    notes: item?.notes ?? "",
    planB,
  };
}

/** True when the end time is before the start, so it means the next day. */
export function endRollsOver(values) {
  return Boolean(values.startTime && values.endTime && values.endTime < values.startTime);
}

/**
 * The whole activity, as the API's full replace expects it. An explicit
 * timezone on the original (an import-only fallback) is carried over.
 */
export function toPayload(values, original) {
  return compact({
    date: values.date,
    title: values.title.trim(),
    start: values.startTime ? `${values.date}T${values.startTime}` : null,
    end: values.endTime
      ? `${endRollsOver(values) ? addDays(values.date, 1) : values.date}T${values.endTime}`
      : null,
    timezone: original?.timezone ?? null,
    location: locationFrom(values.place, values.locationUrl),
    confirmationNumber: values.confirmationNumber.trim() || null,
    notes: values.notes.trim() ? values.notes : null,
    // Left out for plan A, the default: the payload reads as it always did.
    planB: values.planB ? true : null,
  });
}

/** Checks worth doing before a round trip. The server re-checks everything. */
export function validate(values) {
  const errors = {};
  if (!values.title.trim()) errors.title = "Give the activity a title";
  if (values.place && !values.place.name.trim()) errors.place = "Give the place a name";
  if (!values.place && values.locationUrl.trim()) errors.locationUrl = "Pick a place to add a link";
  if (values.endTime && !values.startTime) errors.endTime = "Add a start time first";
  return errors;
}

const ACTIVITY_PATHS = {
  title: "title",
  date: "date",
  start: "startTime",
  end: "endTime",
  location: "place",
  "location.name": "place",
  "location.url": "locationUrl",
  confirmationNumber: "confirmationNumber",
  notes: "notes",
};

/**
 * Server errors ({path, message}) -> { fields: {field: message}, other: [...] }.
 * Each form passes its own path -> field map.
 */
export function mapServerErrors(errors, paths = ACTIVITY_PATHS) {
  const fields = {};
  const other = [];
  for (const err of errors) {
    const field = paths[err.path] ?? paths[err.path.split(".")[0]];
    if (field && !fields[field]) fields[field] = err.message;
    else other.push(err);
  }
  return { fields, other };
}
