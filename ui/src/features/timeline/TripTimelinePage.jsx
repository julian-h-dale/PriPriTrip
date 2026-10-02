import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { DayPanel } from "@/features/timeline/DayPanel";
import { DayTabs } from "@/features/timeline/DayTabs";
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

/** The timeline for one loaded trip. Keyed by trip id, so expand state resets per trip. */
function TripTimeline({ trip }) {
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [openEntries, setOpenEntries] = useState(() => new Set());

  // The selected day lives in the URL (?day=2026-05-11) so a reload, the back
  // button, or a shared link lands on the same day. Unknown dates fall back to
  // the first day.
  const requested = searchParams.get("day");
  const index = Math.max(0, rows.findIndex((r) => r.date === requested));
  const row = rows[index];

  function select(date) {
    setSearchParams({ day: date }, { replace: true });
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
        <DayTabs rows={rows} selected={row.date} onSelect={select} />
      </div>

      <DayPanel
        key={row.date}
        row={row}
        index={index}
        trip={trip}
        openEntries={openEntries}
        onToggleEntry={(key) => setOpenEntries((s) => toggleIn(s, key))}
        prev={rows[index - 1]}
        next={rows[index + 1]}
        onSelect={select}
      />
    </>
  );
}

function TimelineSkeleton() {
  return (
    <div aria-label="Loading trip" className="flex flex-col gap-3">
      <div className="h-12 w-3/4 animate-pulse rounded-md bg-card" />
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 w-[4.25rem] animate-pulse rounded-md border border-border bg-card" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg border border-border bg-card" />
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
