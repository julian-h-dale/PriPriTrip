import { useEffect, useId, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Camera, Eye, ImagePlus, MapPin, MapPinOff, X } from "lucide-react";
import { MAX_PHOTO_BYTES, MAX_PHOTOS, createMemory, updateMemory } from "@/features/journal/journalSlice";
import { photoSrc } from "@/features/journal/photoUrls";
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

function PhotoTile({ src, label, onRemove }) {
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        className="absolute right-0.5 top-0.5 rounded-sm bg-black/60 p-0.5 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Photos for a memory: "Take photo" opens the phone's camera app
 * (`capture`), and "Add photos" opens the phone's own picker (the library;
 * iOS also offers the camera there, recent Android doesn't). No camera code
 * of ours, and taking or choosing a photo is the permission. New picks preview from the phone's copy; existing ones
 * (when editing) can be removed. At most 10, 25 MB each.
 */
function usePhotoPicks(existing) {
  const [added, setAdded] = useState([]); // [{ key, file, url }]
  const [removed, setRemoved] = useState(() => new Set());
  const [problem, setProblem] = useState(null);
  const urls = useRef([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL?.(u)), []);

  const kept = existing.filter((p) => !removed.has(p.id));
  const room = MAX_PHOTOS - kept.length - added.length;

  function add(fileList) {
    const files = [...fileList];
    const tooBig = files.filter((f) => f.size > MAX_PHOTO_BYTES);
    const fitting = files.filter((f) => f.size <= MAX_PHOTO_BYTES).slice(0, Math.max(0, room));
    const picked = fitting.map((file) => {
      let url = null;
      try {
        url = URL.createObjectURL(file);
        urls.current.push(url);
      } catch {
        // no preview available; it still uploads
      }
      return { key: crypto.randomUUID(), file, url };
    });
    setAdded((a) => [...a, ...picked]);
    const skipped = files.length - tooBig.length - fitting.length;
    setProblem(
      tooBig.length
        ? `${tooBig.length === 1 ? "A photo is" : `${tooBig.length} photos are`} over 25 MB and ${tooBig.length === 1 ? "wasn’t" : "weren’t"} added.`
        : skipped > 0
          ? `A memory holds at most ${MAX_PHOTOS} photos.`
          : null
    );
  }

  return {
    kept,
    added,
    room,
    problem,
    add,
    dropAdded: (key) => setAdded((a) => a.filter((p) => p.key !== key)),
    dropExisting: (id) => setRemoved((r) => new Set(r).add(id)),
    removedIds: [...removed],
    files: added.map((p) => p.file),
  };
}

/**
 * "Visible to viewers": people following the trip (viewers) see only public
 * memories. Off by default — a memory is just for the travelers unless its
 * author shares it.
 */
function PublicSwitch({ id, checked, onChange }) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-hint`}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full transition-transform ${
            checked ? "translate-x-6 bg-primary-foreground" : "translate-x-1 bg-muted-foreground"
          }`}
        />
      </button>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Eye className="h-4 w-4" aria-hidden="true" />
          Visible to viewers
        </label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {checked
            ? "People following the trip will see this memory and its photos."
            : "Only people who can edit the trip see this."}
        </p>
      </div>
    </div>
  );
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
  const [isPublic, setIsPublic] = useState(memory?.isPublic ?? false);
  const here = useNewMemoryLocation(open && !memory);
  const photos = usePhotoPicks(memory?.photos ?? []);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
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
      await dispatch(
        updateMemory({
          tripId,
          id: memory.id,
          text: trimmed,
          isPublic,
          clearLocation: dropLocation,
          addFiles: photos.files,
          removePhotoIds: photos.removedIds,
        })
      );
    } else {
      const location = await here.resolve();
      await dispatch(createMemory({ tripId, text: trimmed, location, files: photos.files, isPublic }));
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
        <PublicSwitch id={`${ids}-public`} checked={isPublic} onChange={setIsPublic} />
        <div className="flex flex-col gap-2">
          {(photos.kept.length > 0 || photos.added.length > 0) && (
            <div className="flex flex-wrap gap-2" aria-label="Photos">
              {photos.kept.map((p, i) => (
                <PhotoTile
                  key={p.id}
                  src={photoSrc(p.thumbUrl)}
                  label={`Remove photo ${i + 1}`}
                  onRemove={() => photos.dropExisting(p.id)}
                />
              ))}
              {photos.added.map((p, i) => (
                <PhotoTile
                  key={p.key}
                  src={p.url}
                  label={`Remove new photo ${i + 1}`}
                  onRemove={() => photos.dropAdded(p.key)}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Take a photo"
              tabIndex={-1}
              onChange={(e) => {
                photos.add(e.target.files ?? []);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={photos.room <= 0}
              onClick={() => cameraInput.current?.click()}
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Take photo
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Choose photos"
              tabIndex={-1}
              onChange={(e) => {
                photos.add(e.target.files ?? []);
                e.target.value = ""; // picking the same photo again still fires
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={photos.room <= 0}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Add photos
            </Button>
          </div>
          {photos.problem && <p className="text-xs text-warning">{photos.problem}</p>}
          {photos.added.length > 0 && (
            <p className="text-xs text-muted-foreground">
              New photos wait on this phone until you tap Upload in the Journal.
            </p>
          )}
        </div>
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
