import { useId, useState } from "react";
import {
  endRollsOver,
  mapServerErrors,
  toFormValues,
  toPayload,
  validate,
} from "@/features/timeline/activityForm";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select } from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { datesInRange, formatDayHeading } from "@/shared/utils/time";

function Field({ id, label, error, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Add or edit one activity. Hand-written on purpose: the form is how trip data
 * gets checked by eye. Times are entered on the chosen day; an end before the
 * start means the next day. `onSave(payload)` resolves to `{ ok }` or
 * `{ detail, errors }` from the server.
 */
export function ActivityForm({ open, onClose, trip, item, date, onSave }) {
  const ids = useId();
  const [values, setValues] = useState(() => toFormValues(item, date));
  const [errors, setErrors] = useState({});
  const [other, setOther] = useState(null);
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
    setOther(null);
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
    setOther({ detail: result.detail, errors: mapped.other });
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

          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Place</legend>
            <Field id={fieldId("locationName")} label="Name" error={errors.locationName}>
              <Input {...inputProps("locationName")} autoComplete="off" />
            </Field>
            <Field id={fieldId("locationAddress")} label="Address" error={errors.locationAddress}>
              <Input {...inputProps("locationAddress")} autoComplete="off" />
            </Field>
            <Field id={fieldId("locationUrl")} label="Link" error={errors.locationUrl} hint="https://…">
              <Input type="url" {...inputProps("locationUrl")} />
            </Field>
          </fieldset>

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

          {other && (other.errors.length > 0 || Object.keys(errors).length === 0) && (
            <div role="alert" className="rounded-md border border-destructive/60 p-3 text-sm">
              <p className="font-medium text-destructive">{other.detail}</p>
              {other.errors.map((err, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  <code className="font-mono text-foreground">{err.path}</code> {err.message}
                </p>
              ))}
            </div>
          )}
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
