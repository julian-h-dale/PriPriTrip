import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AutoHeight from "embla-carousel-auto-height";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
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

/** One day's own timeline: its entries as points on an hour-ordered rail. */
function DayDetail({ trip, row }) {
  const dispatch = useDispatch();

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
          ? replaceItem({ tripId, itemId: record.id, item: payload, version: record.version })
          : createItem({ tripId, item: payload })
        : kind === "stay"
          ? replaceStay({ tripId, stayId: record.id, stay: payload, version: record.version })
          : replaceTravel({ tripId, travelId: record.id, travel: payload, version: record.version });
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
        ? deleteItem({ tripId, itemId: record.id, version: record.version })
        : kind === "stay"
          ? deleteStay({ tripId, stayId: record.id, version: record.version })
          : deleteTravel({ tripId, travelId: record.id, version: record.version })
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

  return (
    <div>
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
          onSave={(payload) =>
            // A date with no day row yet is version 0.
            runEdit(dispatch, updateDay({ tripId: trip.id, date: row.date, day: payload, version: day?.version ?? 0 }))
          }
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

/** Whether an arrow key should change the day: not while typing, not with a
 * modifier, and not while a dialog is open. */
function arrowChangesDay(e) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
  return !document.querySelector('[role="dialog"]');
}

/**
 * Every day of the trip as a slide: swipe (or drag, or the arrow keys) to
 * the next or previous day. Only the current day and its neighbours render
 * their timeline. The URL is the source of truth: settling on a day replaces
 * the URL (so Back isn't a list of every day swiped past), and a URL change
 * from elsewhere (the timeline, search) jumps straight to that day.
 */
function DaySwiper({ trip, date }) {
  const navigate = useNavigate();
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  const index = rows.findIndex((r) => r.date === date);
  const [emblaRef, emblaApi] = useEmblaCarousel({ startIndex: Math.max(index, 0) }, [AutoHeight()]);
  // Read by the Embla listeners, which outlive a render.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const dateRef = useRef(date);
  dateRef.current = date;
  const fromUrl = useRef(false); // the carousel is following the URL, not a swipe
  const toTop = useRef(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!emblaApi) return undefined;
    function onSelect() {
      if (fromUrl.current) return;
      const next = rowsRef.current[emblaApi.selectedScrollSnap()]?.date;
      if (!next || next === dateRef.current) return;
      toTop.current = true;
      navigate(`/trips/${trip.id}/days/${next}`, { replace: true });
    }
    function onSettle() {
      if (!toTop.current) return;
      toTop.current = false;
      const root = wrapRef.current?.closest("[data-scroll-root]");
      if (root) root.scrollTop = 0;
    }
    emblaApi.on("select", onSelect).on("settle", onSettle);
    return () => {
      emblaApi.off("select", onSelect).off("settle", onSettle);
    };
  }, [emblaApi, navigate, trip.id]);

  // A day picked elsewhere: jump there, no animation.
  useEffect(() => {
    if (!emblaApi || index < 0 || emblaApi.selectedScrollSnap() === index) return;
    fromUrl.current = true;
    emblaApi.scrollTo(index, true);
    fromUrl.current = false;
  }, [emblaApi, index]);

  useEffect(() => {
    if (!emblaApi) return undefined;
    function onKeyDown(e) {
      if (!arrowChangesDay(e)) return;
      if (e.key === "ArrowLeft") emblaApi.scrollPrev();
      else emblaApi.scrollNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [emblaApi]);

  if (index === -1) {
    return (
      <Card className="mx-4 flex flex-col items-center gap-3 p-8 text-center">
        <p className="font-medium">No such day</p>
        <p className="text-sm text-muted-foreground">It&rsquo;s outside this trip&rsquo;s dates.</p>
        <Link to={`/trips/${trip.id}`} className={buttonVariants({ variant: "outline" })}>
          Back to trip
        </Link>
      </Card>
    );
  }

  return (
    <div ref={wrapRef}>
      <div ref={emblaRef} className="overflow-hidden">
        {/* items-start: each slide is only as tall as its own day; AutoHeight
            sizes the container to the day in view. pan-y keeps vertical
            scrolling the browser's. */}
        <div className="flex touch-pan-y touch-pinch-zoom items-start transition-[height] duration-200">
          {rows.map((r, i) => {
            const current = i === index;
            return (
              <div
                key={r.date}
                className="min-w-0 shrink-0 grow-0 basis-full px-4"
                aria-hidden={current ? undefined : "true"}
                // Off-screen days can't be focused or read out.
                inert={current ? undefined : ""}
              >
                {Math.abs(i - index) <= 1 && <DayDetail trip={trip} row={r} />}
              </div>
            );
          })}
        </div>
      </div>
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
      <div className="mx-auto max-w-2xl py-6">
        {current ? (
          <DaySwiper key={current.id} trip={current} date={date} />
        ) : status === "notFound" ? (
          <Card className="mx-4 flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">Trip not found</p>
            <p className="text-sm text-muted-foreground">It may have been deleted.</p>
            <Link to="/trips" className={buttonVariants({ variant: "outline" })}>
              Back to trips
            </Link>
          </Card>
        ) : status === "failed" ? (
          <Card className="mx-4 flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">Couldn’t load this trip</p>
            <Button variant="outline" onClick={() => dispatch(fetchTrip(tripId))}>
              Try again
            </Button>
          </Card>
        ) : (
          <div className="px-4">
            <DetailSkeleton />
          </div>
        )}
      </div>
    </BottomNavLayout>
  );
}
