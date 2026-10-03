import { useEffect, useId, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { MapPin, MapPinOff, X } from "lucide-react";
import { createMemory, updateMemory } from "@/features/journal/journalSlice";
import { locationLabel } from "@/features/journal/nearestPlace";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { currentPosition, geolocationAvailable, permissionState } from "@/shared/services/geolocation";

const MAX = 2000;

function Chip({ icon: Icon, children, onRemove, removeLabel, muted = false }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
        muted ? "border-border text-muted-foreground" : "border-primary/50 text-primary"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 rounded-sm p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/**
 * A new memory's location: attached by default. If the browser already
 * allows it, a fix starts as the dialog opens; if it hasn't asked yet, the
 * browser asks on the first Save. Saving never waits more than ~8 s for it.
 */
function useNewMemoryLocation(active) {
  const [attach, setAttach] = useState(true);
  const [position, setPosition] = useState(null);
  // "idle" (not asked yet) | "locating" | "ready" | "denied"
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!active || !geolocationAvailable()) return undefined;
    let live = true;
    permissionState().then(async (state) => {
      if (!live) return;
      if (state === "denied") {
        setStatus("denied");
        return;
      }
      if (state !== "granted") return; // ask on Save, in context
      setStatus("locating");
      const pos = await currentPosition();
      if (!live) return;
      setPosition(pos);
      setStatus(pos ? "ready" : "denied");
    });
    return () => {
      live = false;
    };
  }, [active]);

  /** The location to save with: the fix we have, or one more try (asks the first time). */
  async function resolve() {
    if (!active || !attach || !geolocationAvailable() || status === "denied") return null;
    if (position) return position;
    setStatus("locating");
    const pos = await currentPosition();
    setPosition(pos);
    setStatus(pos ? "ready" : "denied");
    return pos;
  }

  return { attach, setAttach, position, status, resolve };
}

/**
 * Write a memory, or change the words of one of yours. Saving is instant and
 * works offline: the memory goes into the phone's outbox and syncs when
 * there's a connection. Its time is the moment Save is first tapped, and
 * editing never changes it. A new memory carries where the phone was (unless
 * removed); an edit can drop that location but never adds one.
 */
export function MemoryDialog({ open, onClose, tripId, memory = null }) {
  const dispatch = useDispatch();
  const ids = useId();
  const trip = useSelector((s) => (s.timeline?.trip?.id === tripId ? s.timeline.trip : null));
  const [text, setText] = useState(memory?.text ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dropLocation, setDropLocation] = useState(false);
  const here = useNewMemoryLocation(open && !memory);
  const trimmed = text.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!trimmed) {
      setError("Write something to remember.");
      return;
    }
    setBusy(true);
    setError(null);
    if (memory) {
      await dispatch(updateMemory({ tripId, id: memory.id, text: trimmed, clearLocation: dropLocation }));
    } else {
      const location = await here.resolve();
      await dispatch(createMemory({ tripId, text: trimmed, location }));
    }
    setBusy(false);
    onClose();
  }

  let locationChip = null;
  if (memory) {
    if (memory.location && !dropLocation) {
      locationChip = (
        <Chip icon={MapPin} onRemove={() => setDropLocation(true)} removeLabel="Remove location">
          {locationLabel(trip, memory.location)}
        </Chip>
      );
    } else if (memory.location) {
      locationChip = (
        <Chip icon={MapPinOff} muted onRemove={() => setDropLocation(false)} removeLabel="Keep location">
          Location will be removed
        </Chip>
      );
    }
  } else if (geolocationAvailable()) {
    if (!here.attach) {
      locationChip = (
        <button
          type="button"
          onClick={() => here.setAttach(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          Add location
        </button>
      );
    } else if (here.status === "denied") {
      locationChip = (
        <Chip icon={MapPinOff} muted>
          Location unavailable
        </Chip>
      );
    } else {
      const label =
        here.status === "ready"
          ? locationLabel(trip, here.position)
          : here.status === "locating"
            ? "Finding your location…"
            : "Location will be added";
      locationChip = (
        <Chip icon={MapPin} onRemove={() => here.setAttach(false)} removeLabel="Don’t add location">
          {label}
        </Chip>
      );
    }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title={memory ? "Edit memory" : "New memory"}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-text`}>What happened?</Label>
          <Textarea
            id={`${ids}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={MAX}
            placeholder="A meal, a museum, a funny joke…"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-hint`}
            autoFocus
          />
          <p id={`${ids}-hint`} className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span role={error ? "alert" : undefined} className="text-destructive">
              {error}
            </span>
            <span>
              {text.length}/{MAX}
            </span>
          </p>
        </div>
        {locationChip && <div>{locationChip}</div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !trimmed}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
