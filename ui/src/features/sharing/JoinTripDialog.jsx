import { useId, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { joinTrip } from "@/features/trips/tripsSlice";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paste a trip's id (from its owner's Share screen) to join it as a viewer. */
export function JoinTripDialog({ open, onClose }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const ids = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const tripId = value.trim();
    if (!UUID.test(tripId)) {
      setError("That doesn’t look like a trip id. It’s the long code from the Share screen.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await dispatch(joinTrip(tripId));
    setBusy(false);
    if (result.meta.requestStatus === "fulfilled") {
      onClose();
      navigate(`/trips/${result.payload.id}/today`);
    } else {
      setError(result.payload);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Join a trip"
      description="Paste the trip id its owner shared with you. You’ll see the whole trip; only the owner can change it."
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-id`}>Trip id</Label>
          <Input
            id={`${ids}-id`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 3f2b8c1e-…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
          />
          {error && (
            <p id={`${ids}-error`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? "Joining…" : "Join"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
