import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { describeEntry } from "@/features/timeline/describeEntry";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { TimelineEntry } from "@/features/timeline/TimelineEntry";
import { Markdown } from "@/shared/components/Markdown";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { formatDateRange, formatShortDate, formatWeekday, zoneLabel } from "@/shared/utils/time";

function toggleIn(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function DayRow({ row, index, trip, open, onToggle, openEntries, onToggleEntry }) {
  const empty = row.entries.length === 0;
  // A date with no day entry is titled by what's on it ("Chicago → Zürich"),
  // shown muted so it reads as derived, not authored.
  const fallback = empty
    ? "No plans"
    : row.entries.map((e) => describeEntry(e, trip).title).join(" · ");
  const panelId = `day-${row.date}`;

  return (
    <li>
      <Card className={cn("overflow-hidden", open && "border-primary/50")}>
        <h2>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex w-[5rem] shrink-0 flex-col">
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {formatWeekday(row.date)} · {row.afterTrip ? "After" : `Day ${index + 1}`}
              </span>
              <span className="whitespace-nowrap text-sm font-semibold">{formatShortDate(row.date)}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "break-words text-sm",
                  row.title ? "font-medium" : "text-muted-foreground",
                  !row.title && !empty && "line-clamp-2"
                )}
              >
                {row.title ?? fallback}
              </span>
              {!empty && (
                <span className="text-xs text-muted-foreground">
                  {row.entries.length} {row.entries.length === 1 ? "entry" : "entries"}
                </span>
              )}
            </span>
            <ChevronDown
              className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </h2>

        {open && (
          <div id={panelId} className="border-t border-border">
            {row.summary && (
              <Markdown className="border-b border-border px-3 py-2.5 text-muted-foreground">
                {row.summary}
              </Markdown>
            )}
            {empty ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">Nothing planned for this day.</p>
            ) : (
              <ul>
                {row.entries.map((entry) => (
                  <TimelineEntry
                    key={entry.key}
                    entry={entry}
                    trip={trip}
                    expanded={openEntries.has(`${row.date}:${entry.key}`)}
                    onToggle={() => onToggleEntry(`${row.date}:${entry.key}`)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

/** The timeline for one loaded trip. Keyed by trip id, so expand state resets per trip. */
function TripTimeline({ trip }) {
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  const [openDays, setOpenDays] = useState(() => new Set());
  const [openEntries, setOpenEntries] = useState(() => new Set());
  const allOpen = openDays.size === rows.length;

  return (
    <>
      <header className="mb-4 flex flex-col gap-1">
        <h1 className="break-words text-xl font-semibold leading-snug">{trip.name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDateRange(trip.startDate, trip.endDate)} · Times are local
          {" "}({zoneLabel(trip.timezone)} unless noted)
        </p>
      </header>

      <div className="mb-3 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpenDays(allOpen ? new Set() : new Set(rows.map((r) => r.date)))}
        >
          {allOpen ? (
            <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />
          )}
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
      </div>

      <ol className="flex flex-col gap-2" aria-label="Trip days">
        {rows.map((row, index) => (
          <DayRow
            key={row.date}
            row={row}
            index={index}
            trip={trip}
            open={openDays.has(row.date)}
            onToggle={() => setOpenDays((s) => toggleIn(s, row.date))}
            openEntries={openEntries}
            onToggleEntry={(key) => setOpenEntries((s) => toggleIn(s, key))}
          />
        ))}
      </ol>
    </>
  );
}

function TimelineSkeleton() {
  return (
    <div aria-label="Loading trip" className="flex flex-col gap-2">
      <div className="mb-4 h-12 w-3/4 animate-pulse rounded-md bg-card" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}

export function TripTimelinePage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);

  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Trips
      </Link>

      {current ? (
        <TripTimeline key={current.id} trip={current} />
      ) : status === "notFound" ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-medium">Trip not found</p>
          <p className="text-sm text-muted-foreground">It may have been deleted.</p>
          <Link to="/" className={buttonVariants({ variant: "outline" })}>
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
        <TimelineSkeleton />
      )}
    </div>
  );
}
