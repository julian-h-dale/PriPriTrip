import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { ActivityForm } from "@/features/timeline/ActivityForm";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { DayForm } from "@/features/timeline/DayForm";
import { runEdit } from "@/features/timeline/runEdit";
import { StayForm } from "@/features/timeline/StayForm";
import { TimelineEntry } from "@/features/timeline/TimelineEntry";
import {
  createItem,
  deleteItem,
  deleteStay,
  deleteTravel,
  fetchTrip,
  moveItem,
  replaceItem,
  replaceStay,
  replaceTravel,
  selectIsViewer,
  selectReadOnly,
  updateDay,
} from "@/features/timeline/timelineSlice";
import { TravelForm } from "@/features/timeline/TravelForm";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Markdown } from "@/shared/components/Markdown";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils/cn";
import { daysBetween, formatDayHeading } from "@/shared/utils/time";

function ActivityActions({ entry, busy, readOnly, onEdit, onMove, onDelete }) {
  const title = entry.item.title;
  return (
    <div className="flex flex-wrap gap-1 border-t border-border pt-3">
      <Button variant="outline" size="sm" onClick={onEdit} disabled={readOnly} aria-label={`Edit ${title}`}>
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onMove("up")}
        disabled={readOnly || busy || entry.index === 0}
        aria-label={`Move ${title} up`}
      >
        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        Up
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onMove("down")}
        disabled={readOnly || busy || entry.index === entry.count - 1}
        aria-label={`Move ${title} down`}
      >
        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        Down
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-destructive hover:bg-destructive hover:text-destructive-foreground"
        onClick={onDelete}
        disabled={readOnly}
        aria-label={`Delete ${title}`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </Button>
    </div>
  );
}

function BookingActions({ kind, record, readOnly, onEdit, onDelete }) {
  const name = kind === "stay" ? record.name : record.title;
  return (
    <div className="flex flex-wrap gap-1 border-t border-border pt-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onEdit(record)}
        disabled={readOnly}
        aria-label={`Edit ${kind} ${name}`}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Edit {kind}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-destructive hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => onDelete(record)}
        disabled={readOnly}
        aria-label={`Delete ${kind} ${name}`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </Button>
    </div>
  );
}

function deleteMessage({ kind, record }) {
  if (kind === "activity") return `“${record.title}” will be removed from this day.`;
  if (kind === "stay") return `“${record.name}” will be removed from every day it covers.`;
  return `“${record.title}” will be removed from the timeline.`;
}

function AdjacentDayLink({ date, tripId, direction }) {
  if (!date) return <span />;
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <Link to={`/trips/${tripId}/days/${date}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
      {direction === "prev" && <Icon className="h-4 w-4" aria-hidden="true" />}
      {formatDayHeading(date)}
      {direction === "next" && <Icon className="h-4 w-4" aria-hidden="true" />}
    </Link>
  );
}

// A horizontal swipe at least this long (px), and clearly more sideways than
// up/down, changes day — so scrolling the page never does.
const SWIPE_MIN_PX = 60;

/** Touch handlers: swipe left/right for the next/previous day. */
function useDaySwipe({ prevUrl, nextUrl }) {
  const navigate = useNavigate();
  const start = useRef(null);
  return {
    onTouchStart(e) {
      // React bubbles events from portals (the edit dialogs) through here
      // too; a swipe inside a dialog must not change the day.
      if (!e.currentTarget.contains(e.target)) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd(e) {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
      const url = dx < 0 ? nextUrl : prevUrl;
      if (url) navigate(url);
    },
  };
}

/** One day's own timeline: its entries as points on an hour-ordered rail. */
function DayDetail({ trip, date }) {
  const dispatch = useDispatch();
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  const index = rows.findIndex((r) => r.date === date);
  const row = index === -1 ? null : rows[index];

  // `form` / `deleting`: null, or { kind: "activity" | "stay" | "travel", record }.
  // A null record in `form` means "add" — only ever true for an activity here;
  // adding a stay or travel now happens from the trip page's coverage views.
  const [form, setForm] = useState(null);
  const readOnly = useSelector(selectReadOnly);
  // A viewer never edits, so they get no edit controls at all (offline only greys them).
  const isViewer = useSelector(selectIsViewer);
  const [dayFormOpen, setDayFormOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  // `?open=<entry key>` (from trip search) opens that entry and scrolls to it.
  const [searchParams] = useSearchParams();
  const openKey = searchParams.get("open");
  const [openEntries, setOpenEntries] = useState(() => new Set(openKey ? [openKey] : []));
  useEffect(() => {
    if (!openKey) return;
    // Also when already on this day and searching again.
    setOpenEntries((current) => (current.has(openKey) ? current : new Set([...current, openKey])));
    requestAnimationFrame(() =>
      document.getElementById(`entry-${openKey}`)?.scrollIntoView?.({ block: "start" })
    );
  }, [openKey]);
  const dayUrl = (d) => (d ? `/trips/${trip.id}/days/${d}` : null);
  const swipe = useDaySwipe({ prevUrl: dayUrl(rows[index - 1]?.date), nextUrl: dayUrl(rows[index + 1]?.date) });

  if (!row) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="font-medium">No such day</p>
        <p className="text-sm text-muted-foreground">It&rsquo;s outside this trip&rsquo;s dates.</p>
        <Link to={`/trips/${trip.id}`} className={buttonVariants({ variant: "outline" })}>
          Back to trip
        </Link>
      </Card>
    );
  }

  const day = trip.days.find((d) => d.date === row.date) ?? null;
  const editable = !row.afterTrip && !isViewer;
  const heading = formatDayHeading(row.date);
  const blurb = [row.title && `**${row.title}**`, row.summary].filter(Boolean).join(" — ");

  function save(payload) {
    const { kind, record } = form;
    const tripId = trip.id;
    // Stays and travel are only ever edited from here (never added — that
    // moved to the trip page's coverage views), so `record` is always set
    // for those two kinds.
    const thunk =
      kind === "activity"
        ? record
          ? replaceItem({ tripId, itemId: record.id, item: payload })
          : createItem({ tripId, item: payload })
        : kind === "stay"
          ? replaceStay({ tripId, stayId: record.id, stay: payload })
          : replaceTravel({ tripId, travelId: record.id, travel: payload });
    return runEdit(dispatch, thunk);
  }

  async function move(item, direction) {
    setBusy(true);
    await dispatch(moveItem({ tripId: trip.id, itemId: item.id, direction }));
    setBusy(false);
  }

  async function confirmDelete() {
    const { kind, record } = deleting;
    const tripId = trip.id;
    setBusy(true);
    await dispatch(
      kind === "activity"
        ? deleteItem({ tripId, itemId: record.id })
        : kind === "stay"
          ? deleteStay({ tripId, stayId: record.id })
          : deleteTravel({ tripId, travelId: record.id })
    );
    setBusy(false);
    setDeleting(null);
  }

  function toggleEntry(key) {
    setOpenEntries((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const addButton = editable && (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setForm({ kind: "activity", record: null })}
      disabled={readOnly} title={readOnly ? "You’re offline" : undefined}
      aria-label={`Add activity to ${heading}`}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add activity
    </Button>
  );

  const dayCount = daysBetween(trip.startDate, trip.endDate) + 1;
  const dayNumber = daysBetween(trip.startDate, row.date) + 1;
  const adjacent = (
    <div className="flex items-center justify-between gap-3">
      <AdjacentDayLink date={rows[index - 1]?.date} tripId={trip.id} direction="prev" />
      <AdjacentDayLink date={rows[index + 1]?.date} tripId={trip.id} direction="next" />
    </div>
  );

  return (
    <div {...swipe}>
      <div className="mb-4">{adjacent}</div>

      <header className="mb-4 flex flex-col gap-1">
        <h1 className="break-words text-xl font-semibold leading-snug">{heading}</h1>
        <p className="text-sm text-muted-foreground">
          {row.afterTrip ? "The morning after the trip" : `Day ${dayNumber} of ${dayCount}`}
        </p>
        {blurb && <Markdown className="text-sm text-muted-foreground">{blurb}</Markdown>}
      </header>

      {row.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing planned for this day.</p>
      ) : (
        <ol aria-label={`Plans for ${heading}`} className="mb-4 flex flex-col">
          {row.entries.map((entry) => (
            <TimelineEntry
              key={entry.key}
              entry={entry}
              trip={trip}
              expanded={openEntries.has(entry.key)}
              onToggle={() => toggleEntry(entry.key)}
              actions={
                isViewer ? null : entry.kind === "activity" ? (
                  <ActivityActions
                    entry={entry}
                    busy={busy}
                    readOnly={readOnly}
                    onEdit={() => setForm({ kind: "activity", record: entry.item })}
                    onMove={(direction) => move(entry.item, direction)}
                    onDelete={() => setDeleting({ kind: "activity", record: entry.item })}
                  />
                ) : (
                  // Stay and travel markers edit the booking itself.
                  <BookingActions
                    kind={entry.kind}
                    record={entry.kind === "stay" ? entry.stay : entry.travel}
                    readOnly={readOnly}
                    onEdit={(record) => setForm({ kind: entry.kind, record })}
                    onDelete={(record) => setDeleting({ kind: entry.kind, record })}
                  />
                )
              }
            />
          ))}
        </ol>
      )}

      {editable && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          {addButton}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDayFormOpen(true)}
            disabled={readOnly} title={readOnly ? "You’re offline" : undefined}
            aria-label={`Edit ${heading} title and summary`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit day
          </Button>
        </div>
      )}

      <div className="mt-6">{adjacent}</div>

      {form?.kind === "activity" && (
        <ActivityForm
          key={form.record?.id ?? "new"}
          open
          onClose={() => setForm(null)}
          trip={trip}
          item={form.record}
          date={row.date}
          onSave={save}
        />
      )}
      {form?.kind === "stay" && (
        <StayForm
          key={form.record?.id ?? "new"}
          open
          onClose={() => setForm(null)}
          trip={trip}
          stay={form.record}
          date={row.date}
          onSave={save}
        />
      )}
      {form?.kind === "travel" && (
        <TravelForm
          key={form.record?.id ?? "new"}
          open
          onClose={() => setForm(null)}
          trip={trip}
          travel={form.record}
          date={row.date}
          onSave={save}
        />
      )}

      {dayFormOpen && (
        <DayForm
          open
          onClose={() => setDayFormOpen(false)}
          date={row.date}
          day={day}
          onSave={(payload) => runEdit(dispatch, updateDay({ tripId: trip.id, date: row.date, day: payload }))}
        />
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => !busy && setDeleting(null)}
        title={deleting ? `Delete ${deleting.kind}?` : ""}
        description={deleting ? deleteMessage(deleting) : ""}
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

function DetailSkeleton() {
  return (
    <div aria-label="Loading day" className="flex flex-col gap-3">
      <div className="h-8 w-1/2 animate-pulse rounded-md bg-card" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="ml-7 h-16 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}

export function DayDetailPage() {
  const { tripId, date } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);
  const online = useSelector((s) => s.network?.online ?? true);

  // Also re-runs when the connection changes (see TripTimelinePage).
  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId, online]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  return (
    <BottomNavLayout tripId={tripId}>
      <div className="mx-auto max-w-2xl px-4 py-6">
        {current ? (
          <DayDetail key={`${current.id}:${date}`} trip={current} date={date} />
        ) : status === "notFound" ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">Trip not found</p>
            <p className="text-sm text-muted-foreground">It may have been deleted.</p>
            <Link to="/trips" className={buttonVariants({ variant: "outline" })}>
              Back to trips
            </Link>
          </Card>
        ) : status === "failed" ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">Couldn’t load this trip</p>
            <Button variant="outline" onClick={() => dispatch(fetchTrip(tripId))}>
              Try again
            </Button>
          </Card>
        ) : (
          <DetailSkeleton />
        )}
      </div>
    </BottomNavLayout>
  );
}
