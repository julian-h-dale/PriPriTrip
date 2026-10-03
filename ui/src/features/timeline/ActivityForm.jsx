import { useId, useState } from "react";
import {
  endRollsOver,
  mapServerErrors,
  toFormValues,
  toPayload,
  validate,
} from "@/features/timeline/activityForm";
import { biasPoint } from "@/features/timeline/bookingForms";
import { Field, FormProblems } from "@/features/timeline/FormParts";
import { PlaceField } from "@/features/timeline/PlaceField";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Select } from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { datesInRange, formatDayHeading } from "@/shared/utils/time";

/**
 * Add or edit one activity. Hand-written on purpose: the form is how trip data
 * gets checked by eye. Times are entered on the chosen day as wall-clock times;
 * an end before the start means the next day. Which clock they're on comes
 * from the place (or, without one, that night's stay). `onSave(payload)`
 * resolves to `{ ok }` or `{ detail, errors }` from the server.
 */
export function ActivityForm({ open, onClose, trip, item, date, prefill, onSave }) {
  const ids = useId();
  const [values, setValues] = useState(() => toFormValues(item, date, prefill));
  const [errors, setErrors] = useState({});
  const [problems, setProblems] = useState(null);
  const [busy, setBusy] = useState(false);

  const fieldId = (name) => `${ids}-${name}`;
  function set(name) {
    return (e) => setValues((v) => ({ ...v, [name]: e.target.value }));
  }
  function inputProps(name) {
    return {
      id: fieldId(name),
      value: values[name],
      onChange: set(name),
      "aria-invalid": errors[name] ? true : undefined,
      "aria-describedby": errors[name] ? `${fieldId(name)}-error` : undefined,
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const local = validate(values);
    setErrors(local);
    setProblems(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    const result = await onSave(toPayload(values, item));
    setBusy(false);
    if (result.ok) {
      onClose();
      return;
    }
    const mapped = mapServerErrors(result.errors ?? []);
    setErrors(mapped.fields);
    if (mapped.other.length || !Object.keys(mapped.fields).length) {
      setProblems({ detail: result.detail, errors: mapped.other });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={item ? "Edit activity" : "Add activity"}
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col gap-4">
        <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
          <Field id={fieldId("title")} label="Title" error={errors.title}>
            <Input {...inputProps("title")} autoComplete="off" />
          </Field>

          <Field id={fieldId("date")} label="Day" error={errors.date}>
            <Select {...inputProps("date")}>
              {datesInRange(trip.startDate, trip.endDate).map((d) => (
                <option key={d} value={d}>
                  {formatDayHeading(d)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id={fieldId("startTime")} label="Start" error={errors.startTime} hint="Optional">
              <Input type="time" {...inputProps("startTime")} />
            </Field>
            <Field
              id={fieldId("endTime")}
              label="End"
              error={errors.endTime}
              hint={endRollsOver(values) ? "+1 day" : "Optional"}
            >
              <Input type="time" {...inputProps("endTime")} />
            </Field>
          </div>

          <PlaceField
            label="Place"
            value={values.place}
            onChange={(place) => setValues((v) => ({ ...v, place }))}
            error={errors.place}
            near={biasPoint(trip)}
            fallbackZone={trip.timezone}
            hint="Optional. Without one, times use where you’re staying that night."
          />

          <Field id={fieldId("locationUrl")} label="Link" error={errors.locationUrl} hint="https://…">
            <Input type="url" {...inputProps("locationUrl")} />
          </Field>

          <Field
            id={fieldId("confirmationNumber")}
            label="Confirmation number"
            error={errors.confirmationNumber}
          >
            <Input {...inputProps("confirmationNumber")} autoComplete="off" />
          </Field>

          <Field id={fieldId("notes")} label="Notes" error={errors.notes} hint="Markdown supported">
            <Textarea rows={4} {...inputProps("notes")} />
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
