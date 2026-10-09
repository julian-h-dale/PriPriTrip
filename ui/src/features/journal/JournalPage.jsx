import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CloudUpload, Eye, MapPin, Pencil, Trash2 } from "lucide-react";
import { journalDays, memoryTime } from "@/features/journal/journalDays";
import {
  canWriteMemories,
  deleteMemory,
  fetchMemories,
  removeStuck,
  retryStuck,
  selectStuckCount,
  selectUpload,
  selectWaitingPhotos,
  uploadPhotos,
} from "@/features/journal/journalSlice";
import { MemoryDialog } from "@/features/journal/MemoryDialog";
import { locationLabel } from "@/features/journal/nearestPlace";
import { PhotoStrip } from "@/features/journal/PhotoStrip";
import { mapsUrl } from "@/shared/utils/mapsLinks";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { RowMenu } from "@/shared/components/RowMenu";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { formatDayHeading, zoneLabel } from "@/shared/utils/time";
import { selectOnline, selectSavedOnly } from "@/shared/networkSlice";

function groupHeading(group) {
  if (group.kind === "before") return "Before the trip";
  if (group.kind === "after") return "After the trip";
  return formatDayHeading(group.date);
}

/** Photos on a memory that exist only on this phone (waiting, or refused by the server). */
const photosOnlyHere = (memory) => (memory?.photos ?? []).filter((p) => p.pending);

function MemoryCard({ memory, trip, onEdit, onDelete, onRemoveStuck }) {
  const dispatch = useDispatch();
  const online = useSelector(selectOnline);
  const stuckPhotos = (memory.photos ?? []).filter((p) => p.stuck);
  const zoneNote = memory.zone !== trip.timezone ? ` · ${zoneLabel(memory.zone)} time` : "";
  // Viewers only ever see public memories, so the badge is for the travelers.
  const showPublic = memory.isPublic && canWriteMemories(trip);
  return (
    <Card className="flex gap-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-sm">{memory.text}</p>
        <PhotoStrip
          photos={memory.photos}
          onRetry={(photo) => dispatch(retryStuck([`photo-${photo.id}`]))}
          onRemove={(photo) => dispatch(removeStuck({ tripId: trip.id, entryId: `photo-${photo.id}` }))}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {memoryTime(memory)}
          {zoneNote} · {memory.mine ? "You" : memory.authorEmail}
          {memory.updatedAt && " · edited"}
        </p>
        {showPublic && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Public
          </p>
        )}
        {memory.location && (
          <a
            href={mapsUrl(memory.location)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {locationLabel(trip, memory.location)}
          </a>
        )}
        {memory.unsaved ? (
          <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-destructive">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Not saved on this phone: copy your words before closing the app.
          </p>
        ) : memory.stuck ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <p className="flex items-start gap-1 text-xs text-destructive">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Couldn’t upload: {memory.stuck.message}. It’s still on this phone.
              </span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!online} onClick={() => dispatch(retryStuck([memory.id]))}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRemoveStuck(memory)}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          memory.pending && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-warning">
              <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
              Waiting to sync
            </p>
          )
        )}
        {stuckPhotos.length > 0 && (
          <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {stuckPhotos.length === 1 ? "A photo" : `${stuckPhotos.length} photos`} couldn’t upload:{" "}
              {stuckPhotos[0].stuck.message}. Open {stuckPhotos.length === 1 ? "it" : "one"} to save a copy, try
              again or remove it.
            </span>
          </p>
        )}
      </div>
      {memory.mine && (
        <RowMenu
          label="Memory options"
          items={[
            {
              label: "Edit",
              icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
              onSelect: () => onEdit(memory),
            },
            {
              label: "Delete",
              icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
              destructive: true,
              onSelect: () => onDelete(memory),
            },
          ]}
        />
      )}
    </Card>
  );
}

const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Photos wait on the phone until Upload is tapped (a web app can't tell
 * Wi-Fi from cellular), so this bar shows while any are waiting — across
 * all trips, since Upload sends them all.
 */
function UploadBar() {
  const dispatch = useDispatch();
  const { count, bytes } = useSelector(selectWaitingPhotos);
  const upload = useSelector(selectUpload);
  const online = useSelector(selectOnline);
  const savedOnly = useSelector(selectSavedOnly);
  if (count === 0 && !upload) return null;
  return (
    <Card role="region" aria-label="Photos waiting to upload" className="flex flex-col gap-2 border-warning/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-medium">
          <CloudUpload className="h-4 w-4 text-warning" aria-hidden="true" />
          {upload
            ? `Uploading ${Math.min(upload.done + 1, upload.total)} of ${upload.total}…`
            : `${count} ${count === 1 ? "photo" : "photos"} waiting · ${megabytes(bytes)}`}
        </p>
        <Button size="sm" onClick={() => dispatch(uploadPhotos())} disabled={Boolean(upload) || !online}>
          {upload ? "Uploading…" : "Upload"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {online
          ? "Upload when you’re on Wi-Fi."
          : savedOnly
            ? "Saved copies only — upload once it’s off, on Wi-Fi."
            : "You’re offline — upload when you’re back on Wi-Fi."} Photos taken
        here aren’t in your camera roll: open one and tap Save to phone to keep a copy.
      </p>
    </Card>
  );
}

/**
 * Writes the server refused stay on the phone (Run stage 24): this says how
 * many, and "Try all again" sends them once more (after a fix, say).
 */
function StuckBar() {
  const dispatch = useDispatch();
  const count = useSelector(selectStuckCount);
  const online = useSelector(selectOnline);
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  async function retryAll() {
    setBusy(true);
    await dispatch(retryStuck());
    setBusy(false);
  }
  return (
    <Card role="region" aria-label="Couldn’t upload" className="flex flex-col gap-2 border-destructive/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
          {count} couldn’t upload
        </p>
        <Button size="sm" variant="outline" onClick={retryAll} disabled={busy || !online}>
          {busy ? "Trying…" : "Try all again"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The server turned {count === 1 ? "it" : "them"} down. {count === 1 ? "It stays" : "They stay"} on this
        phone until sent or removed, and Upload tries again too.
      </p>
    </Card>
  );
}

function Journal({ trip }) {
  const dispatch = useDispatch();
  const writer = canWriteMemories(trip);
  const { items, tripId, status } = useSelector((s) => s.journal);
  const groups = useMemo(
    () => journalDays(tripId === trip.id ? items : [], trip),
    [items, tripId, trip]
  );
  // null | { memory } (edit). A new one is the top bar's New memory.
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(null); // a stuck memory to give up on
  const [busy, setBusy] = useState(false);
  const onlyHere = photosOnlyHere(deleting ?? removing).length;

  async function confirmRemove() {
    setBusy(true);
    await dispatch(removeStuck({ tripId: trip.id, entryId: removing.id }));
    setBusy(false);
    setRemoving(null);
  }

  async function confirmDelete() {
    setBusy(true);
    await dispatch(deleteMemory({ tripId: trip.id, id: deleting.id }));
    setBusy(false);
    setDeleting(null);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Journal</h1>
          <p className="text-sm text-muted-foreground">
            {writer ? "Everyone’s memories from this trip" : "What the travelers have shared"}
          </p>
        </div>
      </header>

      {writer && <StuckBar />}
      {writer && <UploadBar />}

      {groups.length === 0 ? (
        status === "loading" ? (
          <div aria-label="Loading memories" className="h-20 animate-pulse rounded-lg border border-border bg-card" />
        ) : (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">{writer ? "No memories yet" : "Nothing shared yet"}</p>
            <p className="text-sm text-muted-foreground">
              {writer
                ? "A meal, a museum, a funny joke — write it down while it’s fresh."
                : "Memories the travelers share will show up here."}
            </p>
          </Card>
        )
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-label={groupHeading(group)} className="flex flex-col gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.kind === "day" ? (
                <Link to={`/trips/${trip.id}/days/${group.date}`} className="hover:text-foreground">
                  {groupHeading(group)}
                </Link>
              ) : (
                groupHeading(group)
              )}
            </h2>
            <ol className="flex flex-col gap-2">
              {group.memories.map((memory) => (
                <li key={memory.id}>
                  <MemoryCard
                    memory={memory}
                    trip={trip}
                    onEdit={(m) => setEditing({ memory: m })}
                    onDelete={setDeleting}
                    onRemoveStuck={setRemoving}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))
      )}

      {editing && (
        <MemoryDialog
          key={editing.memory?.id ?? "new"}
          open
          onClose={() => setEditing(null)}
          tripId={trip.id}
          memory={editing.memory}
        />
      )}
      <Dialog
        open={deleting !== null}
        onClose={() => !busy && setDeleting(null)}
        title="Delete memory?"
        description={
          onlyHere > 0
            ? `It will be removed from the journal for everyone. ${onlyHere === 1 ? "A photo on it hasn’t" : `${onlyHere} photos on it haven’t`} uploaded and will be deleted from this phone: open ${onlyHere === 1 ? "it" : "each"} and tap Save to phone first to keep a copy.`
            : "It will be removed from the journal for everyone."
        }
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
        title="Remove from this phone?"
        description={
          removing?.receivedAt
            ? "This edit never reached the server. Removing it keeps the memory as it was before."
            : `This memory never reached the server, so removing it deletes it for good.${onlyHere > 0 ? ` ${onlyHere === 1 ? "Its photo goes" : `Its ${onlyHere} photos go`} too: save ${onlyHere === 1 ? "it" : "them"} to the phone first to keep a copy.` : ""}`
        }
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirmRemove} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

export function JournalPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);
  const online = useSelector(selectOnline);

  // Also re-runs when the connection changes (see TripTimelinePage).
  useEffect(() => {
    dispatch(fetchTrip(tripId));
    dispatch(fetchMemories(tripId));
  }, [dispatch, tripId, online]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  return (
    <BottomNavLayout tripId={tripId}>
      {current ? (
        <Journal key={current.id} trip={current} />
      ) : status === "notFound" || status === "failed" ? (
        <div className="mx-auto max-w-2xl px-4 py-6">
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">Couldn’t load this trip</p>
            <Link to="/trips" className={buttonVariants({ variant: "outline" })}>
              Back to trips
            </Link>
          </Card>
        </div>
      ) : (
        <div aria-label="Loading trip" className="mx-auto max-w-2xl px-4 py-6">
          <div className="h-24 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      )}
    </BottomNavLayout>
  );
}
