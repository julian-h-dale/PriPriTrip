import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CloudUpload } from "lucide-react";
import { authorKey, authorStyles, FALLBACK_STYLE } from "@/features/journal/authorColors";
import { journalDays } from "@/features/journal/journalDays";
import {
  canWriteMemories,
  fetchMemories,
  retryStuck,
  selectStuckCount,
  selectUpload,
  selectWaitingPhotos,
  uploadPhotos,
} from "@/features/journal/journalSlice";
import { MemoryTile } from "@/features/journal/MemoryTile";
import { RailDot } from "@/features/timeline/RailDot";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { formatDayHeading } from "@/shared/utils/time";
import { selectOnline, selectSavedOnly } from "@/shared/networkSlice";

function groupHeading(group) {
  if (group.kind === "before") return "Before the trip";
  if (group.kind === "after") return "After the trip";
  return formatDayHeading(group.date);
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

// Where the journal was scrolled to when a memory was opened, per trip, so
// Back lands on the same spot.
const savedScroll = new Map();
const scrollRoot = () => document.querySelector("[data-scroll-root]");

/** "● You ● PriPri ● Sam": what the colors mean. */
function Legend({ styles }) {
  if (styles.size < 2) return null;
  return (
    <ul aria-label="Who wrote what" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {[...styles.entries()].map(([key, style]) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} aria-hidden="true" />
          {style.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The journal as a timeline (Run stage 26): a plain divider for each day
 * (sticky while you scroll its memories), then that day's memories in the
 * order they were written, each a point on the rail in its author's color.
 */
function Journal({ trip }) {
  const writer = canWriteMemories(trip);
  const { items, tripId, status } = useSelector((s) => s.journal);
  const memories = useMemo(() => (tripId === trip.id ? items : []), [items, tripId, trip.id]);
  const groups = useMemo(() => journalDays(memories, trip), [memories, trip]);
  const styles = useMemo(() => authorStyles(memories, trip), [memories, trip]);

  // Back from a memory: scroll to where the journal was.
  const ready = groups.length > 0;
  useLayoutEffect(() => {
    const top = savedScroll.get(trip.id);
    if (!ready || top == null) return;
    savedScroll.delete(trip.id);
    const root = scrollRoot();
    if (root) root.scrollTop = top;
  }, [ready, trip.id]);
  const remember = () => savedScroll.set(trip.id, scrollRoot()?.scrollTop ?? 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-2">
        <div>
          <h1 className="text-xl font-semibold">Journal</h1>
          <p className="text-sm text-muted-foreground">
            {writer ? "Everyone’s memories from this trip" : "What the travelers have shared"}
          </p>
        </div>
        <Legend styles={styles} />
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
          <section key={group.key} aria-label={groupHeading(group)}>
            <h2 className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-background/95 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
              {group.kind === "day" ? (
                <Link to={`/trips/${trip.id}/days/${group.date}`} className="shrink-0 hover:text-foreground">
                  {groupHeading(group)}
                </Link>
              ) : (
                <span className="shrink-0">{groupHeading(group)}</span>
              )}
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </h2>
            <ol className="pt-1">
              {group.memories.map((memory) => {
                const style = styles.get(authorKey(memory)) ?? FALLBACK_STYLE;
                return (
                  <li key={memory.id} className="relative pb-3 pl-7">
                    <RailDot colorClassName={style.dot} />
                    <MemoryTile
                      memory={memory}
                      to={`/trips/${trip.id}/journal/${memory.id}`}
                      style={style}
                      showPublic={memory.isPublic && writer}
                      onOpen={remember}
                    />
                    {memory.unsaved && (
                      <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-destructive">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Not saved on this phone: copy your words before closing the app.
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
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
