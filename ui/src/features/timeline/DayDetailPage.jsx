import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { entryPathFor } from "@/features/entry/entries";
import { ActivityForm } from "@/features/timeline/ActivityForm";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { DayForm } from "@/features/timeline/DayForm";
import { runEdit } from "@/features/timeline/runEdit";
import { TimelineEntry } from "@/features/timeline/TimelineEntry";
import { createItem, fetchTrip, moveItem, selectIsViewer, selectReadOnly, updateDay } from "@/features/timeline/timelineSlice";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Markdown } from "@/shared/components/Markdown";
import { RowMenu } from "@/shared/components/RowMenu";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { daysBetween, formatDayHeading } from "@/shared/utils/time";

/** ⋯ on an activity's row (editors): move it up or down the day. Edit and
 * Delete are on the activity's own page. */
function MoveMenu({ entry, busy, readOnly, onMove }) {
  const title = entry.item.title;
  const why = readOnly ? "You’re offline" : undefined;
  return (
    <RowMenu
      label={`More for ${title}`}
      items={[
        {
          label: "Move up",
          icon: <ArrowUp className="h-4 w-4" aria-hidden="true" />,
          disabled: readOnly || busy || entry.index === 0,
          title: why,
          onSelect: () => onMove("up"),
        },
        {
          label: "Move down",
          icon: <ArrowDown className="h-4 w-4" aria-hidden="true" />,
          disabled: readOnly || busy || entry.index === entry.count - 1,
          title: why,
          onSelect: () => onMove("down"),
        },
      ]}
    />
  );
}

/** One day's own timeline: its entries as points on an hour-ordered rail.
 * Each row opens its entry's page (Run stage 13). */
function DayDetail({ trip, row }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const readOnly = useSelector(selectReadOnly);
  // A viewer never edits, so they get no edit controls at all (offline only greys them).
  const isViewer = useSelector(selectIsViewer);
  const [dayFormOpen, setDayFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // `?open=<entry key>`: an older search link. It now opens the entry's page.
  const [searchParams] = useSearchParams();
  const openKey = searchParams.get("open");
  useEffect(() => {
    const entry = openKey && row.entries.find((e) => e.key === openKey);
    if (entry) navigate(entryPathFor(trip.id, entry), { replace: true, state: { atKey: entry.key } });
  }, [openKey, row.entries, navigate, trip.id]);

  const day = trip.days.find((d) => d.date === row.date) ?? null;
  const editable = !row.afterTrip && !isViewer;
  const heading = formatDayHeading(row.date);
  const blurb = [row.title && `**${row.title}**`, row.summary].filter(Boolean).join(" — ");

  async function move(item, direction) {
    setBusy(true);
    await dispatch(moveItem({ tripId: trip.id, itemId: item.id, direction }));
    setBusy(false);
  }

  const addButton = editable && (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setAdding(true)}
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
              menu={
                editable && entry.kind === "activity" && entry.count > 1 ? (
                  <MoveMenu entry={entry} busy={busy} readOnly={readOnly} onMove={(direction) => move(entry.item, direction)} />
                ) : null
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

      {adding && (
        <ActivityForm
          key="new"
          open
          onClose={() => setAdding(false)}
          trip={trip}
          item={null}
          date={row.date}
          onSave={(payload) => runEdit(dispatch, createItem({ tripId: trip.id, item: payload }))}
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
  const [emblaRef, emblaApi] = useEmblaCarousel({ startIndex: Math.max(index, 0) });
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
        {/* items-start: each slide is only as tall as its own day, and the
            carousel as tall as its tallest slide, so the day in view grows
            as its entries expand. The neighbours are capped at one screen
            (only their top shows mid-swipe), so a long day next door can't
            leave empty space under a short one. pan-y keeps vertical
            scrolling the browser's. */}
        <div className="flex touch-pan-y touch-pinch-zoom items-start">
          {rows.map((r, i) => {
            const current = i === index;
            return (
              <div
                key={r.date}
                className={cn("min-w-0 shrink-0 grow-0 basis-full px-4", !current && "max-h-dvh overflow-hidden")}
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
    <BottomNavLayout tripId={tripId} backTo={`/trips/${tripId}`}>
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
