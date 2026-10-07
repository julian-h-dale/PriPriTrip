import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Home, List, Plane } from "lucide-react";
import { entryPath } from "@/features/entry/entries";
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
  selectReadOnly,
} from "@/features/timeline/timelineSlice";
import { TravelForm } from "@/features/timeline/TravelForm";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { formatDateRange } from "@/shared/utils/time";
import { todayIn } from "@/shared/utils/tripDates";

// Plan | Stays | Travel: exactly one at a time. (Was two unlabeled House/
// Plane icon toggles; labeled segments are easier to find — ui_review §4.)
const VIEWS = [
  { view: "plan", icon: List, label: "Plan" },
  { view: "stays", icon: Home, label: "Stays" },
  { view: "travel", icon: Plane, label: "Travel" },
];

/**
 * The timeline for one loaded trip: a date per row, linking to that day's own
 * page. The House/Plane buttons switch the whole list into a coverage view —
 * exactly one of plan/stays/travel at a time, never combined. In a coverage
 * view, selecting a date opens that stay's or leg's own page (or the add form
 * when there's none) instead of the day page — unless a date has more than
 * one travel leg, where the day page is the only place both are listed.
 */
function TripTimeline({ trip }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const readOnly = useSelector(selectReadOnly);
  // A viewer follows the plan: no Stays / Travel views (Run stage 17).
  const isViewer = trip.role === "viewer";
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  // Past days are greyed, judged on the trip's own calendar.
  const today = todayIn(trip.timezone);
  const [view, setView] = useState("plan");
  const stayCov = useMemo(() => stayCoverage(trip), [trip]);
  const travelCov = useMemo(() => travelCoverage(trip), [trip]);
  const coverageByDate = view === "stays" ? stayCov : view === "travel" ? travelCov : null;
  // null, or { kind: "stay" | "travel", record, date }. A null record means "add".
  const [form, setForm] = useState(null);


  function selectDate(date) {
    if (view === "stays") {
      const stay = stayCov.get(date)?.stay;
      if (stay) navigate(entryPath(trip.id, "stay", stay.id));
      else if (readOnly) navigate(`/trips/${trip.id}/days/${date}`);
      else setForm({ kind: "stay", record: null, date });
      return;
    }
    const travels = travelCov.get(date)?.travels ?? [];
    if (travels.length > 1) {
      navigate(`/trips/${trip.id}/days/${date}`);
    } else if (travels.length === 1) {
      navigate(entryPath(trip.id, "travel", travels[0].id));
    } else if (readOnly) {
      navigate(`/trips/${trip.id}/days/${date}`);
    } else {
      setForm({ kind: "travel", record: null, date });
    }
  }

  // Only ever adding here: an existing booking is edited on its own page.
  function saveBooking(payload) {
    const tripId = trip.id;
    const thunk =
      form.kind === "stay" ? createStay({ tripId, stay: payload }) : createTravel({ tripId, travel: payload });
    return runEdit(dispatch, thunk);
  }

  return (
    <>
      <header className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="break-words text-xl font-semibold leading-snug">{trip.name}</h1>
          <p className="text-sm text-muted-foreground">{formatDateRange(trip.startDate, trip.endDate)}</p>
        </div>
        {!isViewer && (
          <div role="group" aria-label="Timeline view" className="grid grid-cols-3 rounded-md border border-border bg-card p-1">
            {VIEWS.map(({ view: v, icon: Icon, label }) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "flex min-h-10 items-center justify-center gap-1.5 rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )}
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
            past={row.date < today}
            isToday={row.date === today}
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
  const online = useSelector((s) => s.network?.online ?? true);

  // Also re-runs when the connection changes: back online refreshes; going
  // offline falls back to the saved copy and marks it stale.
  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId, online]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  return (
    // The page's own heading is the trip name, so the top bar doesn't repeat it.
    <BottomNavLayout tripId={tripId} showTitle={false}>
      <div className="mx-auto max-w-2xl px-4 py-6">
        {current ? (
          <TripTimeline key={current.id} trip={current} />
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
          <TimelineSkeleton />
        )}
      </div>
    </BottomNavLayout>
  );
}
