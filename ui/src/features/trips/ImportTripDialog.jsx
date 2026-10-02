import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { importTrip } from "@/features/trips/tripsSlice";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

/**
 * Pick a trip document (.json) and upload it. Every import creates a brand-new
 * trip; a rejected document lists each problem with its path so it can be
 * fixed in one pass.
 */
export function ImportTripDialog({ open, onClose }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  function close() {
    if (busy) return;
    setFile(null);
    setFailure(null);
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setFailure(null);
    const result = await dispatch(importTrip(file));
    setBusy(false);
    if (importTrip.fulfilled.match(result)) {
      setFile(null);
      onClose();
      navigate(`/trips/${result.payload.id}`);
    } else {
      setFailure(result.payload ?? { detail: "Import failed", errors: [] });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import trip"
      description="Upload a trip document (.json). Each import creates a new trip."
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="trip-file">Trip document</Label>
          <Input
            id="trip-file"
            type="file"
            accept=".json,application/json"
            className="h-auto py-1.5 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setFailure(null);
            }}
          />
        </div>

        {failure && (
          <div
            role="alert"
            className="flex min-h-0 flex-col gap-2 rounded-md border border-destructive/60 p-3"
          >
            <p className="text-sm font-medium text-destructive">{failure.detail}</p>
            {failure.errors.length > 0 && (
              <ul className="max-h-60 overflow-y-auto text-xs" aria-label="Problems">
                {failure.errors.map((err, i) => (
                  <li key={i} className="border-t border-border py-1.5 first:border-t-0">
                    <code className="break-all font-mono text-foreground">{err.path}</code>
                    <span className="block text-muted-foreground">{err.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={!file || busy}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
