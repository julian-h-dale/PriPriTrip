import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Home, Plane } from "lucide-react";
import { BookingDetailsDialog } from "@/features/timeline/BookingDetailsDialog";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { stayCoverage, travelCoverage } from "@/features/timeline/coverageView";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { DayRow } from "@/features/timeline/DayRow";
import { runEdit } from "@/features/timeline/runEdit";
import { StayForm } from "@/features/timeline/StayForm";
import {
  createStay,
  createTravel,
  fetchTrip,
  replaceStay,
  replaceTravel,
} from "@/features/timeline/timelineSlice";
import { TravelForm } from "@/features/timeline/TravelForm";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { formatDateRange, zoneLabel } from "@/shared/utils/time";

const VIEWS = [
  { view: "stays", icon: Home, label: "Show which nights have a stay" },
  { view: "travel", icon: Plane, label: "Show which days have travel" },
];

/**
 * The timeline for one loaded trip: a date per row, linking to that day's own
 * page. The House/Plane buttons switch the whole list into a coverage view —
 * exactly one of plan/stays/travel at a time, never combined. In a coverage
 * view, selecting a date opens a quick read-only look at that stay/leg (or
 * the add form when there's none) instead of navigating to the day page —
 * unless a date has more than one travel leg, where the day page is the only
 * place both are listed. "Edit" in that quick look switches to the real form.
 */
function TripTimeline({ trip }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  const [view, setView] = useState("plan");
  const stayCov = useMemo(() => stayCoverage(trip), [trip]);
  const travelCov = useMemo(() => travelCoverage(trip), [trip]);
  const coverageByDate = view === "stays" ? stayCov : view === "travel" ? travelCov : null;
  // null, or { kind: "stay" | "travel", record, date }. A null record means "add".
  const [form, setForm] = useState(null);
  // null, or { kind: "stay" | "travel", record } — the read-only quick look.
  const [details, setDetails] = useState(null);

  function toggle(next) {
    setView((current) => (current === next ? "plan" : next));
  }

  function selectDate(date) {
    if (view === "stays") {
      const stay = stayCov.get(date)?.stay;
      if (stay) setDetails({ kind: "stay", record: stay });
      else setForm({ kind: "stay", record: null, date });
      return;
    }
    const travels = travelCov.get(date)?.travels ?? [];
    if (travels.length > 1) {
      navigate(`/trips/${trip.id}/days/${date}`);
    } else if (travels.length === 1) {
      setDetails({ kind: "travel", record: travels[0] });
    } else {
      setForm({ kind: "travel", record: null, date });
    }
  }

  function editFromDetails() {
    setForm({ kind: details.kind, record: details.record, date: trip.startDate });
    setDetails(null);
  }

  function saveBooking(payload) {
    const { kind, record } = form;
    const tripId = trip.id;
    const thunk =
      kind === "stay"
        ? record
          ? replaceStay({ tripId, stayId: record.id, stay: payload })
          : createStay({ tripId, stay: payload })
        : record
          ? replaceTravel({ tripId, travelId: record.id, travel: payload })
          : createTravel({ tripId, travel: payload });
    return runEdit(dispatch, thunk);
  }

  return (
    <>
      <header className="mb-4 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="break-words text-xl font-semibold leading-snug">{trip.name}</h1>
          <div className="flex shrink-0 gap-1">
            {VIEWS.map(({ view: v, icon: Icon, label }) => (
              <Button
                key={v}
                variant={view === v ? "default" : "ghost"}
                size="icon"
                aria-pressed={view === v}
                aria-label={label}
                onClick={() => toggle(v)}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDateRange(trip.startDate, trip.endDate)} · Times are local
          {" "}({zoneLabel(trip.timezone)} unless noted)
        </p>
      </header>

      <ol aria-label="Trip days" className="flex flex-col">
        {rows.map((row) => (
          <DayRow
            key={row.date}
            row={row}
            tripId={trip.id}
            view={view}
            coverage={coverageByDate?.get(row.date)}
            onSelect={selectDate}
          />
        ))}
      </ol>

      {form?.kind === "stay" && (
        <StayForm
          key={form.record?.id ?? "new"}
          open
          onClose={() => setForm(null)}
          trip={trip}
          stay={form.record}
          date={form.date}
          onSave={saveBooking}
        />
      )}
      {form?.kind === "travel" && (
        <TravelForm
          key={form.record?.id ?? "new"}
          open
          onClose={() => setForm(null)}
          trip={trip}
          travel={form.record}
          date={form.date}
          onSave={saveBooking}
        />
      )}

      {details && (
        <BookingDetailsDialog
          open
          onClose={() => setDetails(null)}
          onEdit={editFromDetails}
          trip={trip}
          kind={details.kind}
          record={details.record}
        />
      )}
    </>
  );
}

function TimelineSkeleton() {
  return (
    <div aria-label="Loading trip" className="flex flex-col gap-3">
      <div className="h-12 w-3/4 animate-pulse rounded-md bg-card" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ml-7 h-16 animate-pulse rounded-lg border border-border bg-card" />
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
    <BottomNavLayout tripId={tripId}>
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
    </BottomNavLayout>
  );
}
