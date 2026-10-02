import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { DateJumper } from "@/features/timeline/DateJumper";
import { DayCard } from "@/features/timeline/DayCard";
import { dayId } from "@/features/timeline/dayIds";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { formatDateRange, zoneLabel } from "@/shared/utils/time";

function toggleIn(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** The timeline for one loaded trip. Keyed by trip id, so UI state resets per trip. */
function TripTimeline({ trip }) {
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openEntries, setOpenEntries] = useState(() => new Set());

  // `?day=YYYY-MM-DD` scrolls to that day on load (and is kept current when
  // jumping), so a reload, the back button or a shared link lands on it.
  const requested = searchParams.get("day");
  const known = rows.some((r) => r.date === requested);
  const [current, setCurrent] = useState(() => (known ? requested : rows[0]?.date));
  const initialDay = useRef(known ? requested : null);

  useEffect(() => {
    if (initialDay.current) {
      document.getElementById(dayId(initialDay.current))?.scrollIntoView?.({ block: "start" });
    }
  }, []);

  // Highlight whichever day is crossing the upper part of the screen.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (changes) => {
        const visible = changes
          .filter((c) => c.isIntersecting)
          .sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
        if (visible) setCurrent(visible.target.id.replace(/^day-/, ""));
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );
    rows.forEach((r) => {
      const el = document.getElementById(dayId(r.date));
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [rows]);

  function jump(date) {
    setCurrent(date);
    setSearchParams({ day: date }, { replace: true });
    document.getElementById(dayId(date))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <header className="mb-3 flex flex-col gap-1">
        <h1 className="break-words text-xl font-semibold leading-snug">{trip.name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDateRange(trip.startDate, trip.endDate)} · Times are local
          {" "}({zoneLabel(trip.timezone)} unless noted)
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border bg-background/95 px-4 pt-2 backdrop-blur">
        <DateJumper rows={rows} current={current} onJump={jump} />
      </div>

      <ol aria-label="Trip days" className="flex flex-col">
        {rows.map((row, index) => (
          <DayCard
            key={row.date}
            row={row}
            index={index}
            trip={trip}
            open={!collapsed.has(row.date)}
            onToggleOpen={() => setCollapsed((s) => toggleIn(s, row.date))}
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
    <div aria-label="Loading trip" className="flex flex-col gap-3">
      <div className="h-12 w-3/4 animate-pulse rounded-md bg-card" />
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 w-14 animate-pulse rounded-md border border-border bg-card" />
        ))}
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="ml-7 h-40 animate-pulse rounded-lg border border-border bg-card" />
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
