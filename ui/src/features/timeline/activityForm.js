import { addDays, datePart } from "@/shared/utils/time";

/**
 * Pure helpers behind ActivityForm: activity <-> form values, client checks,
 * and server error paths -> form fields. Kept out of the component so the
 * rules are tested directly.
 */

/** Form state for an existing activity (or a blank one on `date`). */
export function toFormValues(item, date) {
  return {
    title: item?.title ?? "",
    date: item?.start ? datePart(item.start) : date,
    startTime: item?.start?.slice(11, 16) ?? "",
    endTime: item?.end?.slice(11, 16) ?? "",
    locationName: item?.location?.name ?? "",
    locationAddress: item?.location?.address ?? "",
    locationUrl: item?.location?.url ?? "",
    confirmationNumber: item?.confirmationNumber ?? "",
    notes: item?.notes ?? "",
  };
}

/** True when the end time is before the start, so it means the next day. */
export function endRollsOver(values) {
  return Boolean(values.startTime && values.endTime && values.endTime < values.startTime);
}

function locationFrom(values, original) {
  const name = values.locationName.trim();
  if (!name) return null;
  const address = values.locationAddress.trim();
  const url = values.locationUrl.trim();
  const location = { name };
  if (address) location.address = address;
  if (url) location.url = url;
  // Coordinates aren't editable yet (no Places lookup). Keep them only while
  // they still describe the same place; otherwise the map link falls back to
  // the address rather than pointing somewhere stale.
  const prev = original?.location;
  if (prev?.lat != null && prev.name === name && (prev.address ?? "") === address) {
    location.lat = prev.lat;
    location.lng = prev.lng;
  }
  return location;
}

/**
 * The whole activity, as the API's full replace expects it. Fields the form
 * doesn't show (a timezone override) are carried over from the original.
 */
export function toPayload(values, original) {
  const payload = {
    date: values.date,
    title: values.title.trim(),
    start: values.startTime ? `${values.date}T${values.startTime}` : null,
    end: values.endTime
      ? `${endRollsOver(values) ? addDays(values.date, 1) : values.date}T${values.endTime}`
      : null,
    timezone: original?.timezone ?? null,
    location: locationFrom(values, original),
    confirmationNumber: values.confirmationNumber.trim() || null,
    notes: values.notes.trim() ? values.notes : null,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null));
}

/** Checks worth doing before a round trip. The server re-checks everything. */
export function validate(values) {
  const errors = {};
  if (!values.title.trim()) errors.title = "Give the activity a title";
  if (!values.locationName.trim() && (values.locationAddress.trim() || values.locationUrl.trim())) {
    errors.locationName = "Name the place to add an address or link";
  }
  if (values.endTime && !values.startTime) errors.endTime = "Add a start time first";
  return errors;
}

const PATH_TO_FIELD = {
  title: "title",
  date: "date",
  start: "startTime",
  end: "endTime",
  location: "locationName",
  "location.name": "locationName",
  "location.address": "locationAddress",
  "location.url": "locationUrl",
  confirmationNumber: "confirmationNumber",
  notes: "notes",
};

/** Server errors ({path, message}) -> { fields: {field: message}, other: [...] }. */
export function mapServerErrors(errors) {
  const fields = {};
  const other = [];
  for (const err of errors) {
    const field = PATH_TO_FIELD[err.path];
    if (field && !fields[field]) fields[field] = err.message;
    else other.push(err);
  }
  return { fields, other };
}
