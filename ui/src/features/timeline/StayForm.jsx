import { useId, useState } from "react";
import { mapServerErrors } from "@/features/timeline/activityForm";
import {
  STAY_PATHS,
  STAY_TYPES,
  biasPoint,
  stayPayload,
  toStayValues,
  validateStay,
} from "@/features/timeline/bookingForms";
import { Field, FormProblems } from "@/features/timeline/FormParts";
import { PlaceField } from "@/features/timeline/PlaceField";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Select } from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { addDays } from "@/shared/utils/time";

/**
 * Add or edit a stay (a booking spanning nights). The place is required: it
 * sets the clock check-in and check-out are on. Dates and times are entered as
 * written on the booking.
 */
export function StayForm({ open, onClose, trip, stay, date, prefill, onSave }) {
  const ids = useId();
  const [values, setValues] = useState(() => toStayValues(stay, date, trip, prefill));
  const [errors, setErrors] = useState({});
  const [problems, setProblems] = useState(null);
  const [busy, setBusy] = useState(false);

  const fieldId = (name) => `${ids}-${name}`;
  function inputProps(name, errorKey = name) {
    return {
      id: fieldId(name),
      value: values[name],
      onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
      "aria-invalid": errors[errorKey] ? true : undefined,
    };
  }

  function pickPlace(place) {
    // A new stay is usually named after where it is.
    setValues((v) => ({ ...v, place, name: v.name.trim() || !place ? v.name : place.name }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const local = validateStay(values);
    setErrors(local);
    setProblems(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    const result = await onSave(stayPayload(values, stay));
    setBusy(false);
    if (result.ok) {
      onClose();
      return;
    }
    const mapped = mapServerErrors(result.errors ?? [], STAY_PATHS);
    setErrors(mapped.fields);
    if (mapped.other.length || !Object.keys(mapped.fields).length) {
      setProblems({ detail: result.detail, errors: mapped.other });
    }
  }

  const lastDay = addDays(trip.endDate, 1);

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={stay ? "Edit stay" : "Add stay"}
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col gap-4">
        <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
          <PlaceField
            label="Where"
            value={values.place}
            onChange={pickPlace}
            error={errors.place}
            near={biasPoint(trip)}
            fallbackZone={trip.timezone}
          />

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field id={fieldId("name")} label="Name" error={errors.name}>
              <Input {...inputProps("name")} autoComplete="off" />
            </Field>
            <Field id={fieldId("type")} label="Type">
              <Select {...inputProps("type")}>
                {STAY_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Check-in</legend>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                aria-label="Check-in date"
                min={trip.startDate}
                max={trip.endDate}
                {...inputProps("checkInDate", "checkIn")}
              />
              <Input type="time" aria-label="Check-in time" {...inputProps("checkInTime", "checkIn")} />
            </div>
            {errors.checkIn && <p className="text-xs text-destructive">{errors.checkIn}</p>}
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Check-out</legend>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                aria-label="Check-out date"
                min={values.checkInDate || trip.startDate}
                max={lastDay}
                {...inputProps("checkOutDate", "checkOut")}
              />
              <Input type="time" aria-label="Check-out time" {...inputProps("checkOutTime", "checkOut")} />
            </div>
            {errors.checkOut && <p className="text-xs text-destructive">{errors.checkOut}</p>}
          </fieldset>

          <Field id={fieldId("roomType")} label="Room" error={errors.roomType} hint="Optional">
            <Input {...inputProps("roomType")} autoComplete="off" />
          </Field>
          <Field
            id={fieldId("confirmationNumber")}
            label="Confirmation number"
            error={errors.confirmationNumber}
          >
            <Input {...inputProps("confirmationNumber")} autoComplete="off" />
          </Field>
          <Field id={fieldId("locationUrl")} label="Link" error={errors.locationUrl} hint="https://…">
            <Input type="url" {...inputProps("locationUrl")} />
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
