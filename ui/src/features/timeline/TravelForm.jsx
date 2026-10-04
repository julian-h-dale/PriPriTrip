import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { mapServerErrors } from "@/features/timeline/activityForm";
import {
  TRAVEL_MODES,
  TRAVEL_PATHS,
  arrivalWarning,
  autoTitle,
  biasPoint,
  toTravelValues,
  travelPayload,
  validateTravel,
} from "@/features/timeline/bookingForms";
import { Field, FormProblems } from "@/features/timeline/FormParts";
import { PlaceField } from "@/features/timeline/PlaceField";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Select } from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { usePlaceZone } from "@/shared/services/timezoneLookup";
import { addDays, formatTime, zoneLabel } from "@/shared/utils/time";

/** "Departs 5:40 PM Chicago time · lands 9:25 AM Zurich time" for a cross-zone leg. */
function CrossZoneNote({ values, departZone, arriveZone }) {
  if (!departZone || !arriveZone || departZone === arriveZone) return null;
  if (!values.departTime || !values.arriveTime) return null;
  return (
    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      Departs {formatTime(`${values.departDate}T${values.departTime}`)} {zoneLabel(departZone)} time
      {" · "}lands {formatTime(`${values.arriveDate}T${values.arriveTime}`)} {zoneLabel(arriveZone)} time
    </p>
  );
}

/**
 * Add or edit a travel leg. A type, where it leaves from and when are
 * required. Each end is on its own place's clock — the user only enters what
 * the ticket says. A missing arrival is allowed, with a warning.
 */
export function TravelForm({ open, onClose, trip, travel, date, prefill, onSave }) {
  const ids = useId();
  const [values, setValues] = useState(() => toTravelValues(travel, date, prefill));
  const [errors, setErrors] = useState({});
  const [problems, setProblems] = useState(null);
  const [busy, setBusy] = useState(false);
  const departZone = usePlaceZone(values.from) ?? (values.from ? trip.timezone : null);
  const arriveZone = usePlaceZone(values.to) ?? (values.to ? trip.timezone : null);

  const fieldId = (name) => `${ids}-${name}`;
  function inputProps(name, errorKey = name) {
    return {
      id: fieldId(name),
      value: values[name],
      onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
      "aria-invalid": errors[errorKey] ? true : undefined,
    };
  }

  // The title follows the places until the user writes their own.
  function withTitle(next) {
    return next.titleEdited ? next : { ...next, title: autoTitle(next) };
  }
  function pick(end) {
    return (place) =>
      setValues((v) => {
        const next = { ...v, [end]: place };
        if (end === "to" && place && !v.arriveDate) next.arriveDate = v.departDate;
        if (end === "to" && !place) Object.assign(next, { arriveDate: "", arriveTime: "" });
        return withTitle(next);
      });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const local = validateTravel(values);
    setErrors(local);
    setProblems(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    const result = await onSave(travelPayload(values, travel));
    setBusy(false);
    // reloaded: someone else changed or removed it; a warning already said so.
    if (result.ok || result.reloaded) {
      onClose();
      return;
    }
    const mapped = mapServerErrors(result.errors ?? [], TRAVEL_PATHS);
    setErrors(mapped.fields);
    if (mapped.other.length || !Object.keys(mapped.fields).length) {
      setProblems({ detail: result.detail, errors: mapped.other });
    }
  }

  const warning = arrivalWarning(values);
  const near = biasPoint(trip);

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={travel ? "Edit travel" : "Add travel"}
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col gap-4">
        <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
          <Field id={fieldId("mode")} label="Type" error={errors.mode}>
            <Select {...inputProps("mode")}>
              {TRAVEL_MODES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <PlaceField
            label="From"
            value={values.from}
            onChange={pick("from")}
            error={errors.from}
            near={near}
            fallbackZone={trip.timezone}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Departs</legend>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                aria-label="Departure date"
                min={trip.startDate}
                max={trip.endDate}
                {...inputProps("departDate", "depart")}
              />
              <Input type="time" aria-label="Departure time" {...inputProps("departTime", "depart")} />
            </div>
            {errors.depart && <p className="text-xs text-destructive">{errors.depart}</p>}
          </fieldset>

          <PlaceField
            label="To"
            value={values.to}
            onChange={pick("to")}
            error={errors.to}
            near={near}
            fallbackZone={trip.timezone}
          />
          <fieldset className="flex flex-col gap-1.5" disabled={!values.to}>
            <legend className="mb-1.5 text-sm font-medium">Arrives</legend>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                aria-label="Arrival date"
                min={values.departDate || trip.startDate}
                max={addDays(trip.endDate, 1)}
                {...inputProps("arriveDate", "arrive")}
              />
              <Input type="time" aria-label="Arrival time" {...inputProps("arriveTime", "arrive")} />
            </div>
            {!values.to && (
              <p className="text-xs text-muted-foreground">Pick where it lands to set the arrival.</p>
            )}
            {errors.arrive && <p className="text-xs text-destructive">{errors.arrive}</p>}
          </fieldset>

          {warning && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md border border-warning/50 px-3 py-2 text-xs text-warning"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {warning}. You can save, but the timeline can’t show when you land.
            </p>
          )}
          <CrossZoneNote values={values} departZone={departZone} arriveZone={arriveZone} />

          <Field id={fieldId("title")} label="Title" error={errors.title}>
            <Input
              {...inputProps("title")}
              onChange={(e) => setValues((v) => ({ ...v, title: e.target.value, titleEdited: true }))}
              placeholder={autoTitle(values) || "e.g. Zürich → Split"}
              autoComplete="off"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field id={fieldId("carrier")} label="Carrier">
              <Input {...inputProps("carrier")} autoComplete="off" />
            </Field>
            <Field id={fieldId("number")} label="Number">
              <Input {...inputProps("number")} autoComplete="off" />
            </Field>
            <Field id={fieldId("seat")} label="Seat">
              <Input {...inputProps("seat")} autoComplete="off" />
            </Field>
          </div>

          <Field
            id={fieldId("confirmationNumber")}
            label="Confirmation number"
            error={errors.confirmationNumber}
          >
            <Input {...inputProps("confirmationNumber")} autoComplete="off" />
          </Field>
          <Field id={fieldId("notes")} label="Notes" error={errors.notes} hint="Markdown supported">
            <Textarea rows={3} {...inputProps("notes")} />
          </Field>

          <FormProblems problems={problems} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
