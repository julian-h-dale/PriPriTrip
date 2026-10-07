import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import { BedDouble, ChevronRight, DoorOpen, Info, Navigation } from "lucide-react";
import { nextUp, referenceDay, tonight, untilLabel } from "@/features/today/todayView";
import { buildTimeline } from "@/features/timeline/buildTimeline";
import { dayCities } from "@/features/timeline/dayCities";
import { describeEntry } from "@/features/timeline/describeEntry";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { toC, toF } from "@/features/weather/units";
import { weatherIcon } from "@/features/weather/weatherIcon";
import { fetchWeather } from "@/features/weather/weatherSlice";
import { entryPath, entryPathFor } from "@/features/entry/entries";
import { ConfirmationNumber } from "@/features/timeline/EntryDetails";
import { TimelineEntry } from "@/features/timeline/TimelineEntry";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Markdown } from "@/shared/components/Markdown";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { directionsUrl } from "@/shared/utils/mapsLinks";
import { daysBetween, formatDayHeading, formatTime, zoneLabel } from "@/shared/utils/time";
import { selectOnline } from "@/shared/networkSlice";

/**
 * The temperature right now at today's place (before the trip, the first
 * day's), from the trip's weather: a link to the Weather page. Nothing when
 * there's none (weather not set up, the trip is over, not loaded yet).
 */
function WeatherNow({ tripId }) {
  const dispatch = useDispatch();
  const online = useSelector(selectOnline);
  const weather = useSelector((s) => (s.weather?.tripId === tripId ? s.weather.data : null));
  useEffect(() => {
    dispatch(fetchWeather(tripId));
  }, [dispatch, tripId, online]);
  const now = weather?.configured ? weather.today : null;
  if (now?.temp == null) return null;
  const Icon = weatherIcon(now.icon);
  return (
    <Link
      to={`/trips/${tripId}/weather`}
      aria-label={`Weather in ${now.place}: ${toF(now.temp)}°F, ${toC(now.temp)}°C`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-lg font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
      {toF(now.temp)}°
    </Link>
  );
}

function SectionTitle({ children }) {
  return <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h2>;
}

function DirectionsLink({ loc, label = "Directions" }) {
  const url = loc && directionsUrl(loc);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11")}>
      <Navigation className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}

/** Where an entry happens, for Directions: a leg's departure point, else its place. */
function placeOf(entry) {
  if (entry.kind === "travel") return entry.travel.from ?? entry.travel.to ?? null;
  if (entry.kind === "stay") return entry.stay.location ?? null;
  return entry.item.location ?? null;
}

function NextUp({ trip, next, active, now }) {
  if (!next) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">Nothing else with a time on this trip.</Card>
    );
  }
  const d = describeEntry(next.entry, trip);
  const Icon = d.icon;
  const when = `${formatDayHeading(next.date)} · ${formatTime(d.start)}${d.zone !== trip.timezone ? ` (${zoneLabel(d.zone)} time)` : ""}`;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold leading-snug">{d.title}</p>
          {d.subtitle && <p className="break-words text-sm text-muted-foreground">{d.subtitle}</p>}
          <p className="mt-1 text-sm">
            {when}
            {active && <span className="text-muted-foreground"> · {untilLabel(next.instant, now)}</span>}
          </p>
        </div>
      </div>
      {d.confirmation && <ConfirmationNumber value={d.confirmation} />}
      <div className="flex flex-wrap gap-2">
        <DirectionsLink loc={placeOf(next.entry)} />
        <Link to={entryPathFor(trip.id, next.entry)} state={{ atKey: next.entry.key }} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11")}>
          Details
        </Link>
        <Link
          to={`/trips/${trip.id}/days/${next.date}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11")}
        >
          View day
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

function Tonight({ trip, night }) {
  const { stay, checkingOut } = night;
  const zoneNote = (zone) => (zone && zone !== trip.timezone ? ` (${zoneLabel(zone)} time)` : "");
  return (
    <Card className="flex flex-col gap-3 p-4">
      {checkingOut && (
        <p className="flex items-start gap-2 text-sm">
          <DoorOpen className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Check out of <span className="font-medium">{checkingOut.name}</span> by{" "}
            {formatTime(checkingOut.checkOut)}
            {zoneNote(checkingOut.zone)}
          </span>
        </p>
      )}
      {stay ? (
        <>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
              <BedDouble className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold leading-snug">{stay.name}</p>
              {stay.location?.address && (
                <p className="break-words text-sm text-muted-foreground">{stay.location.address}</p>
              )}
              <p className="mt-1 text-sm">
                Check-in {formatDayHeading(stay.checkIn)} · {formatTime(stay.checkIn)}
                {zoneNote(stay.zone)}
              </p>
              {stay.roomType && <p className="text-sm text-muted-foreground">{stay.roomType}</p>}
            </div>
          </div>
          {stay.confirmationNumber && <ConfirmationNumber value={stay.confirmationNumber} />}
          <div className="flex flex-wrap gap-2">
            <DirectionsLink loc={stay.location} />
            <Link to={entryPath(trip.id, "stay", stay.id)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11")}>
              Details
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No stay booked for tonight.</p>
      )}
    </Card>
  );
}

function TodayView({ trip }) {
  // "Now" is read once per visit; reopening the tab refreshes it.
  const [now] = useState(() => new Date());
  const rows = useMemo(() => buildTimeline(trip), [trip]);
  const ref = useMemo(() => referenceDay(trip, now), [trip, now]);
  const next = useMemo(() => nextUp(trip, ref, now), [trip, ref, now]);
  const night = useMemo(() => tonight(trip, ref.date), [trip, ref.date]);
  const index = rows.findIndex((r) => r.date === ref.date);
  const row = rows[index];
  const tomorrow = rows[index + 1] ?? null;
  const dayNumber = daysBetween(trip.startDate, ref.date) + 1;
  const dayCount = daysBetween(trip.startDate, trip.endDate) + 1;


  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{ref.active ? "Today" : "Day 1 preview"}</h1>
          <WeatherNow tripId={trip.id} />
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDayHeading(ref.date)} · Day {dayNumber} of {dayCount}
        </p>
        {!ref.active && (
          <p className="mt-1 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            The trip isn’t under way, so this shows its first day. During the trip it follows today.
          </p>
        )}
      </header>

      <section aria-label="Next up">
        <SectionTitle>Next up</SectionTitle>
        <NextUp trip={trip} next={next} active={ref.active} now={now} />
      </section>

      <section aria-label="Tonight">
        <SectionTitle>Tonight</SectionTitle>
        <Tonight trip={trip} night={night} />
      </section>

      <section aria-label="Today’s plan">
        <SectionTitle>{ref.active ? "Today’s plan" : "Day 1 plan"}</SectionTitle>
        {row && row.entries.length > 0 ? (
          <ol className="flex flex-col">
            {row.entries.map((entry) => (
              <TimelineEntry key={entry.key} entry={entry} trip={trip} />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing planned.</p>
        )}
      </section>

      {tomorrow && (
        <section aria-label="Tomorrow">
          <SectionTitle>Tomorrow</SectionTitle>
          <Link
            to={`/trips/${trip.id}/days/${tomorrow.date}`}
            className="block rounded-lg border border-border bg-card p-3 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-baseline gap-3">
              <span className="shrink-0 font-semibold">{formatDayHeading(tomorrow.date)}</span>
              <span className="min-w-0 flex-1 break-words text-right text-sm text-muted-foreground">
                {dayCities(tomorrow).join(" → ")}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
            </span>
            {tomorrow.title && (
              <Markdown className="mt-1 text-sm text-muted-foreground">{`**${tomorrow.title}**`}</Markdown>
            )}
          </Link>
        </section>
      )}
    </div>
  );
}

export function TodayPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);
  const online = useSelector(selectOnline);

  // Also re-runs when the connection changes (see TripTimelinePage).
  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId, online]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  return (
    <BottomNavLayout tripId={tripId}>
      {current ? (
        <TodayView key={current.id} trip={current} />
      ) : status === "notFound" || status === "failed" ? (
        <div className="mx-auto max-w-2xl px-4 py-6">
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">{status === "notFound" ? "Trip not found" : "Couldn’t load this trip"}</p>
            <Link to="/trips" className={buttonVariants({ variant: "outline" })}>
              Back to trips
            </Link>
          </Card>
        </div>
      ) : (
        <div aria-label="Loading trip" className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      )}
    </BottomNavLayout>
  );
}
