import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CloudUpload, ExternalLink, Eye, ImageOff, MapPin, Pencil, Trash2 } from "lucide-react";
import { authorKey, authorStyles, FALLBACK_STYLE } from "@/features/journal/authorColors";
import { memoryDate, memoryTime } from "@/features/journal/journalDays";
import {
  canWriteMemories,
  deleteMemory,
  fetchMemories,
  removeStuck,
  retryStuck,
} from "@/features/journal/journalSlice";
import { MemoryDialog } from "@/features/journal/MemoryDialog";
import { accuracyLabel, locationLabel } from "@/features/journal/nearestPlace";
import { usePhotoSrc } from "@/features/journal/photoUrls";
import { PhotoViewer } from "@/features/journal/PhotoViewer";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils/cn";
import { mapsUrl } from "@/shared/utils/mapsLinks";
import { formatDayHeading, zoneLabel } from "@/shared/utils/time";
import { selectOnline } from "@/shared/networkSlice";

const SECTION_LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** Photos on a memory that exist only on this phone (waiting, or refused by the server). */
const photosOnlyHere = (memory) => (memory?.photos ?? []).filter((p) => p.pending);

function Slide({ photo, index, count, onOpen }) {
  const src = usePhotoSrc(photo.displayUrl);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Photo ${index + 1} of ${count}${photo.stuck ? ", couldn’t upload" : ""}`}
      className="relative flex aspect-[4/3] w-full shrink-0 snap-center items-center justify-center bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {src && !failed ? (
        <img src={src} alt="" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <ImageOff className="h-6 w-6 text-white/70" aria-hidden="true" />
      )}
      {photo.stuck ? (
        <span className="absolute bottom-2 right-2 rounded-sm bg-destructive p-1" title="Couldn’t upload">
          <AlertTriangle className="h-4 w-4 text-destructive-foreground" aria-hidden="true" />
        </span>
      ) : (
        photo.pending && (
          <span className="absolute bottom-2 right-2 rounded-sm bg-black/60 p-1" title="Waiting to upload">
            <CloudUpload className="h-4 w-4 text-white" aria-hidden="true" />
          </span>
        )
      )}
    </button>
  );
}

/**
 * A memory's photos, full width, swiped sideways (scroll snap); "2 / 3" says
 * where you are. Tapping one opens the full-screen viewer there (full
 * quality, zoom, save to phone, and Try again / Remove for a refused one).
 */
function Photos({ memory, tripId }) {
  const dispatch = useDispatch();
  const photos = memory.photos ?? [];
  const [open, setOpen] = useState(null);
  const [at, setAt] = useState(0);
  const strip = useRef(null);
  if (!photos.length) return null;
  function onScroll() {
    const el = strip.current;
    if (el?.clientWidth) setAt(Math.round(el.scrollLeft / el.clientWidth));
  }
  return (
    <div className="relative -mx-4 sm:mx-0">
      <div
        ref={strip}
        onScroll={onScroll}
        aria-label="Photos"
        className="flex snap-x snap-mandatory overflow-x-auto sm:rounded-md [scrollbar-width:none]"
      >
        {photos.map((photo, i) => (
          <Slide key={photo.id} photo={photo} index={i} count={photos.length} onOpen={() => setOpen(i)} />
        ))}
      </div>
      {photos.length > 1 && (
        <span className="pointer-events-none absolute right-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-xs tabular-nums text-white">
          {Math.min(at, photos.length - 1) + 1} / {photos.length}
        </span>
      )}
      {open !== null && (
        <PhotoViewer
          photos={photos}
          start={open}
          onClose={() => setOpen(null)}
          onRetry={(photo) => dispatch(retryStuck([`photo-${photo.id}`]))}
          onRemove={(photo) => dispatch(removeStuck({ tripId, entryId: `photo-${photo.id}` }))}
        />
      )}
    </div>
  );
}

/** Where it stands with the server: not kept, refused, or waiting. */
function SyncState({ memory, onRemoveStuck }) {
  const dispatch = useDispatch();
  const online = useSelector(selectOnline);
  const stuckPhotos = (memory.photos ?? []).filter((p) => p.stuck);
  return (
    <>
      {memory.unsaved ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Not saved on this phone: copy your words before closing the app.
        </p>
      ) : memory.stuck ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Couldn’t upload: {memory.stuck.message}. It’s still on this phone.</span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!online} onClick={() => dispatch(retryStuck([memory.id]))}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onRemoveStuck}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        memory.pending && (
          <p className="inline-flex items-center gap-1.5 text-sm text-warning">
            <CloudUpload className="h-4 w-4" aria-hidden="true" />
            Waiting to sync
          </p>
        )
      )}
      {stuckPhotos.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {stuckPhotos.length === 1 ? "A photo" : `${stuckPhotos.length} photos`} couldn’t upload:{" "}
            {stuckPhotos[0].stuck.message}. Open {stuckPhotos.length === 1 ? "it" : "one"} to save a copy, try again
            or remove it.
          </span>
        </p>
      )}
    </>
  );
}

function MemoryView({ memory, trip, style }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const journal = `/trips/${trip.id}/journal`;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const onlyHere = photosOnlyHere(memory).length;
  const zoneNote = memory.zone !== trip.timezone ? ` · ${zoneLabel(memory.zone)} time` : "";
  // Viewers only ever see public memories, so the badge is for the travelers.
  const showPublic = memory.isPublic && canWriteMemories(trip);
  const accuracy = memory.location && accuracyLabel(memory.location);

  async function confirmDelete() {
    setBusy(true);
    await dispatch(deleteMemory({ tripId: trip.id, id: memory.id }));
    setBusy(false);
    setDeleting(false);
    navigate(journal, { replace: true });
  }

  async function confirmRemove() {
    setBusy(true);
    await dispatch(removeStuck({ tripId: trip.id, entryId: memory.id }));
    setBusy(false);
    setRemoving(false);
    // A memory that never reached the server is gone; an edit falls back.
    if (!memory.receivedAt) navigate(journal, { replace: true });
  }

  return (
    <article aria-label="Memory" className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <Photos memory={memory} tripId={trip.id} />
      <p className="whitespace-pre-wrap break-words text-base">{memory.text}</p>

      <section aria-label="When and who" className="flex flex-col gap-1 border-t border-border pt-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
          {style.label}
        </span>
        <span className="text-sm text-muted-foreground">
          {memoryTime(memory)} · {formatDayHeading(memoryDate(memory))}
          {zoneNote}
          {memory.updatedAt && " · edited"}
        </span>
        {showPublic && (
          <span className="inline-flex items-center gap-1 text-sm text-primary">
            <Eye className="h-4 w-4" aria-hidden="true" />
            Public
          </span>
        )}
      </section>

      {memory.location && (
        <section aria-label="Where" className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>Where</span>
          <span className="inline-flex items-start gap-1.5 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 break-words">
              {locationLabel(trip, memory.location)}
              {accuracy && <span className="text-muted-foreground"> · {accuracy}</span>}
            </span>
          </span>
          <a
            href={mapsUrl(memory.location)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1 self-start text-sm text-primary underline-offset-2 hover:underline"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open in Maps
          </a>
        </section>
      )}

      <SyncState memory={memory} onRemoveStuck={() => setRemoving(true)} />

      {memory.mine && (
        <div className="flex gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </Button>
          <Button variant="ghost" className="text-destructive hover:bg-destructive hover:text-destructive-foreground" onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </Button>
        </div>
      )}

      {editing && <MemoryDialog open onClose={() => setEditing(false)} tripId={trip.id} memory={memory} />}
      <Dialog
        open={deleting}
        onClose={() => !busy && setDeleting(false)}
        title="Delete memory?"
        description={
          onlyHere > 0
            ? `It will be removed from the journal for everyone. ${onlyHere === 1 ? "A photo on it hasn’t" : `${onlyHere} photos on it haven’t`} uploaded and will be deleted from this phone: open ${onlyHere === 1 ? "it" : "each"} and tap Save to phone first to keep a copy.`
            : "It will be removed from the journal for everyone."
        }
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleting(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={removing}
        onClose={() => !busy && setRemoving(false)}
        title="Remove from this phone?"
        description={
          memory.receivedAt
            ? "This edit never reached the server. Removing it keeps the memory as it was before."
            : `This memory never reached the server, so removing it deletes it for good.${onlyHere > 0 ? ` ${onlyHere === 1 ? "Its photo goes" : `Its ${onlyHere} photos go`} too: save ${onlyHere === 1 ? "it" : "them"} to the phone first to keep a copy.` : ""}`
        }
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setRemoving(false)} disabled={busy}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirmRemove} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </Dialog>
    </article>
  );
}

/**
 * One memory, full size (Run stage 26): its photos, all its words, who wrote
 * it and when (on the clock where it was written), where (place, accuracy,
 * Open in Maps), how it stands with the server, and Edit / Delete for your
 * own. ← goes back to the journal where you were.
 */
export function MemoryPage() {
  const { tripId, memoryId } = useParams();
  const dispatch = useDispatch();
  const { trip, status: tripStatus, tripId: loadedId } = useSelector((s) => s.timeline);
  const { items, tripId: journalTrip, status } = useSelector((s) => s.journal);
  const online = useSelector(selectOnline);

  useEffect(() => {
    dispatch(fetchTrip(tripId));
    dispatch(fetchMemories(tripId));
  }, [dispatch, tripId, online]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;
  const memories = useMemo(() => (journalTrip === tripId ? items : []), [items, journalTrip, tripId]);
  // While the journal reloads, its saved copy can briefly lack a memory that
  // has just synced: keep showing the one we had, so the page (and an open
  // photo) doesn't blink away.
  const lastSeen = useRef(null);
  const found = memories.find((m) => m.id === memoryId);
  if (found) lastSeen.current = found;
  else if (lastSeen.current?.id !== memoryId || status !== "loading") lastSeen.current = null;
  const memory = found ?? lastSeen.current;
  const styles = useMemo(() => authorStyles(memories, current), [memories, current]);
  const loading = !current || (!memory && status === "loading");
  const journal = `/trips/${tripId}/journal`;

  return (
    <BottomNavLayout tripId={tripId} back={journal}>
      {memory && current ? (
        <MemoryView memory={memory} trip={current} style={styles.get(authorKey(memory)) ?? FALLBACK_STYLE} />
      ) : loading && tripStatus !== "notFound" && tripStatus !== "failed" ? (
        <div aria-label="Loading memory" className="mx-auto max-w-2xl px-4 py-4">
          <div className="aspect-[4/3] animate-pulse rounded-md bg-card" />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl px-4 py-6">
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">This memory isn’t here</p>
            <p className="text-sm text-muted-foreground">It may have been deleted.</p>
            <Link to={journal} className={buttonVariants({ variant: "outline" })}>
              Back to the journal
            </Link>
          </Card>
        </div>
      )}
    </BottomNavLayout>
  );
}
