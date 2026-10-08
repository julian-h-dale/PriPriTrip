import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import { CloudUpload, Eye, MapPin, Pencil, Trash2 } from "lucide-react";
import { journalDays, memoryTime } from "@/features/journal/journalDays";
import {
  canWriteMemories,
  deleteMemory,
  fetchMemories,
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

function MemoryCard({ memory, trip, onEdit, onDelete }) {
  const zoneNote = memory.zone !== trip.timezone ? ` · ${zoneLabel(memory.zone)} time` : "";
  // Viewers only ever see public memories, so the badge is for the travelers.
  const showPublic = memory.isPublic && canWriteMemories(trip);
  return (
    <Card className="flex gap-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-sm">{memory.text}</p>
        <PhotoStrip photos={memory.photos} />
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
        {memory.pending && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-warning">
            <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
            Waiting to sync
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
  const [busy, setBusy] = useState(false);

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
        description="It will be removed from the journal for everyone."
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
