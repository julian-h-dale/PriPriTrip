import { useId, useState } from "react";
import { mapServerErrors } from "@/features/timeline/activityForm";
import { biasPoint } from "@/features/timeline/bookingForms";
import { Field, FormProblems } from "@/features/timeline/FormParts";
import { PlaceField } from "@/features/timeline/PlaceField";
import {
  POI_CATEGORIES,
  POI_PATHS,
  poiPayload,
  toPoiValues,
  validatePoi,
} from "@/features/pointsOfInterest/pointsOfInterest";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Select } from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";

/**
 * Add or edit a point of interest: a shop, market or sight worth finding,
 * on the map only. A new one starts from the Google place picked on the map
 * (`prefill: { place, types }`), named after it, its category guessed from
 * Google's types. The place needs coordinates: it's only ever a pin.
 */
export function PointOfInterestForm({ open, onClose, trip, poi, prefill, onSave }) {
  const ids = useId();
  const [values, setValues] = useState(() => toPoiValues(poi, prefill));
  const [errors, setErrors] = useState({});
  const [problems, setProblems] = useState(null);
  const [busy, setBusy] = useState(false);

  const fieldId = (name) => `${ids}-${name}`;
  function inputProps(name) {
    return {
      id: fieldId(name),
      value: values[name],
      onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
      "aria-invalid": errors[name] ? true : undefined,
    };
  }

  function pickPlace(place) {
    setValues((v) => ({ ...v, place, name: v.name.trim() || !place ? v.name : place.name }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const local = validatePoi(values);
    setErrors(local);
    setProblems(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    const result = await onSave(poiPayload(values));
    setBusy(false);
    // reloaded: someone else changed or removed it; a warning already said so.
    if (result.ok || result.reloaded) {
      onClose();
      return;
    }
    const mapped = mapServerErrors(result.errors ?? [], POI_PATHS);
    setErrors(mapped.fields);
    if (mapped.other.length || !Object.keys(mapped.fields).length) {
      setProblems({ detail: result.detail, errors: mapped.other });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={poi ? "Edit point of interest" : "Add point of interest"}
      description="On the map only, on no day."
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
            showClock={false}
          />

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field id={fieldId("name")} label="Name" error={errors.name}>
              <Input {...inputProps("name")} autoComplete="off" />
            </Field>
            <Field id={fieldId("category")} label="Kind" error={errors.category}>
              <Select {...inputProps("category")}>
                {POI_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

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
