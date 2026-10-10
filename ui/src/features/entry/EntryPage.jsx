import { useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, BedDouble } from "lucide-react";
import { EntryActions } from "@/features/entry/EntryActions";
import { entryPath, entrySequence, findEntry, neighbours } from "@/features/entry/entries";
import { PULL_THRESHOLD_PX, pullOffset, useEdgePull } from "@/features/entry/useEdgePull";
import { entryMarkerId, mapFocusPath } from "@/features/map/mapFocus";
import { NearbyPointsOfInterest } from "@/features/pointsOfInterest/NearbyPointsOfInterest";
import { MODE_ICON, MODE_LABEL, describeEntry } from "@/features/timeline/describeEntry";
import { ConfirmationNumber, EditedBy, PlaceRow } from "@/features/timeline/EntryDetails";
import { showsPlanB, usePlanChoices } from "@/features/timeline/planChoice";
import { fetchTrip, selectIsViewer, selectReadOnly } from "@/features/timeline/timelineSlice";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Markdown } from "@/shared/components/Markdown";
import { MiniMap } from "@/shared/components/MiniMap";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { HeroFade } from "@/shared/components/ui/hero-fade";
import { cn } from "@/shared/utils/cn";
import { keepFirstEntry } from "@/shared/utils/firstEntry";
import { useHeroImage } from "@/shared/utils/useHeroImage";
import { datePart, daysBetween, formatDayHeading, formatDuration, formatTime, zoneLabel } from "@/shared/utils/time";
import { selectOnline } from "@/shared/networkSlice";

// Shown in the "when" section, so not repeated in the facts list below it.
const WHEN_FACTS = new Set(["Check-in", "Check-out", "Departs", "Arrives", "Duration"]);

/** The timeline entry describeEntry() expects, for a whole record. */
function asEntry({ kind, record }) {
  if (kind === "activity") return { kind, item: record };
  if (kind === "stay") return { kind, phase: "staying", stay: record };
  return { kind, phase: "depart", travel: record, overnight: false };
}

const SECTION_LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** One end of a booking: its label, the time big, the date, and (when it's
 * not the trip's own) the zone; optionally the place. */
function TimeBlock({ label, wallClock, zone, tripZone, place, align = "left" }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", align === "right" && "items-end text-right")}>
      <span className={SECTION_LABEL}>{label}</span>
      {wallClock ? (
        <>
          <span className="text-2xl font-semibold tabular-nums leading-tight">{formatTime(wallClock)}</span>
          <span className="text-sm text-muted-foreground">
            {formatDayHeading(datePart(wallClock))}
            {zone && zone !== tripZone && ` · ${zoneLabel(zone)} time`}
          </span>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">Not set yet</span>
      )}
      {place && <span className="break-words text-sm">{place}</span>}
    </div>
  );
}

function ActivityWhen({ item, date, zone, tripZone }) {
  if (!item.start) {
    return (
      <section aria-label="When" className="flex flex-col gap-0.5">
        <span className={SECTION_LABEL}>When</span>
        <span className="text-lg font-semibold">{formatDayHeading(date)}</span>
        <span className="text-sm text-muted-foreground">No set time</span>
      </section>
    );
  }
  return (
    <section aria-label="When" className="flex flex-col gap-0.5">
      <span className={SECTION_LABEL}>When</span>
      <span className="text-2xl font-semibold tabular-nums leading-tight">
        {formatTime(item.start)}
        {item.end && ` – ${formatTime(item.end)}`}
      </span>
      <span className="text-sm text-muted-foreground">
        {formatDayHeading(date)}
        {zone !== tripZone && ` · ${zoneLabel(zone)} time`}
      </span>
    </section>
  );
}

function StayWhen({ stay, zone, tripZone }) {
  const nights = daysBetween(datePart(stay.checkIn), datePart(stay.checkOut));
  return (
    <section aria-label="When" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4">
        <TimeBlock label="Check in" wallClock={stay.checkIn} zone={zone} tripZone={tripZone} />
        <TimeBlock label="Check out" wallClock={stay.checkOut} zone={zone} tripZone={tripZone} align="right" />
      </div>
      <p className="text-sm text-muted-foreground">
        {nights} {nights === 1 ? "night" : "nights"}
      </p>
    </section>
  );
}

function TravelWhen({ travel, tripZone }) {
  const departZone = travel.departZone ?? travel.departTimezone ?? tripZone;
  const arriveZone = travel.arriveZone ?? travel.arriveTimezone ?? tripZone;
  const duration = formatDuration(travel.durationMinutes);
  return (
    <section aria-label="When" className="flex flex-col gap-2">
      <TimeBlock label="Departs" wallClock={travel.depart} zone={departZone} tripZone={tripZone} place={travel.from?.name} />
      <p className="flex items-center gap-2 pl-1 text-sm text-muted-foreground">
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
        {duration ?? "—"}
      </p>
      <TimeBlock label="Arrives" wallClock={travel.arrive} zone={arriveZone} tripZone={tripZone} place={travel.to?.name} />
    </section>
  );
}

/** What the page is about: kind, icon, name and a line under it. */
function heading({ kind, record }, d) {
  if (kind === "activity") return { label: "Activity", icon: d.icon, title: record.title, sub: record.location?.name ?? null };
  if (kind === "stay") {
    const sub = record.location && record.location.name !== record.name ? record.location.name : null;
    return { label: "Stay", icon: BedDouble, title: record.name, sub };
  }
  const carrier = [record.carrier, record.number].filter(Boolean).join(" ");
  return { label: MODE_LABEL[record.mode] ?? "Travel", icon: MODE_ICON[record.mode] ?? MODE_ICON.other, title: record.title, sub: carrier || null };
}

const MINI_MAP = "h-40 w-full overflow-hidden rounded-md border border-border";

/**
 * A place's mini map: tapping it opens the trip's map zoomed in on that pin
 * (Run stage 27). With no pin (a plan B activity) it's just a picture. The
 * link covers the map, so Google's own map never takes the tap.
 */
function EntryMiniMap({ trip, markerId, loc }) {
  if (!markerId) return <MiniMap lat={loc.lat} lng={loc.lng} className={MINI_MAP} />;
  return (
    <Link
      to={mapFocusPath(trip.id, markerId)}
      aria-label={`Show ${loc.name} on the map`}
      className="relative block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MiniMap lat={loc.lat} lng={loc.lng} className={MINI_MAP} />
      <span className="absolute inset-0" aria-hidden="true" />
    </Link>
  );
}

/**
 * Everything about one activity, stay or leg (`found`, from findEntry): the
 * photo, the confirmation number first (it's what a desk asks for), when,
 * then the facts, notes and places with their maps, and (for an activity or
 * a stay) the points of interest nearby. `children`: actions.
 * Not `online` (offline, or "Use saved copies only"): no place photo and no
 * maps, which are Google's and would load over the network.
 */
export function EntryView({ trip, found, online = true, children }) {
  const d = describeEntry(asEntry(found), trip);
  const { hero, onError } = useHeroImage(online ? d.hero : null);
  const head = heading(found, d);
  const Icon = head.icon;
  const tripZone = trip.timezone;
  // The heading already says the mode and carrier ("Flight", "SWISS LX 9").
  const facts = d.facts.filter(([label]) => !WHEN_FACTS.has(label) && label !== head.label);
  return (
    <article aria-label={head.title} className="flex flex-col gap-6 pb-6">
      <header className={cn("relative flex flex-col gap-1 px-4 pt-6", hero && "pt-44")}>
        {hero && <HeroFade src={hero} onError={onError} fadeTo="background" className="h-56" />}
        <span className={cn("relative inline-flex items-center gap-1.5", SECTION_LABEL)}>
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          {head.label}
          {found.planB && (
            <span className="ml-1 rounded-sm bg-secondary px-1.5 py-0.5 normal-case tracking-normal text-secondary-foreground">
              Plan B
            </span>
          )}
        </span>
        <h1 className="relative break-words text-2xl font-semibold leading-snug">{head.title}</h1>
        {head.sub && <p className="relative break-words text-sm text-muted-foreground">{head.sub}</p>}
      </header>

      <div className="flex flex-col gap-6 px-4">
        {d.confirmation && <ConfirmationNumber value={d.confirmation} large />}

        {found.kind === "activity" && <ActivityWhen item={found.record} date={found.date} zone={d.zone} tripZone={tripZone} />}
        {found.kind === "stay" && <StayWhen stay={found.record} zone={d.zone} tripZone={tripZone} />}
        {found.kind === "travel" && <TravelWhen travel={found.record} tripZone={tripZone} />}

        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {d.notes && (
          <section aria-label="Notes" className="flex flex-col gap-1">
            <span className={SECTION_LABEL}>Notes</span>
            <Markdown>{d.notes}</Markdown>
          </section>
        )}

        {d.locations.map(({ label, loc }) => (
          <div key={label} className="flex flex-col gap-2">
            <PlaceRow label={label} loc={loc} />
            {online && loc.lat != null && loc.lng != null && (
              <EntryMiniMap trip={trip} markerId={entryMarkerId(found, label)} loc={loc} />
            )}
          </div>
        ))}

        {found.kind !== "travel" && (
          <NearbyPointsOfInterest trip={trip} location={found.record.location} labelClassName={SECTION_LABEL} />
        )}

        {children}
        {d.edited && <EditedBy edited={d.edited} />}
      </div>
    </article>
  );
}

/**
 * What letting go will do, in the room the pull opens above or below the
 * page: the entry it goes to (always on the same day).
 */
function PullHint({ trip, dir, distance, step }) {
  const ready = distance >= PULL_THRESHOLD_PX;
  const Arrow = dir === "prev" ? ArrowUp : ArrowDown;
  const label = dir === "prev" ? "previous" : "next";
  const title = describeEntry(step.entry, trip).title;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute inset-x-0 flex flex-col items-center gap-0.5 px-4 py-3 text-center",
        dir === "prev" ? "bottom-full" : "top-full"
      )}
    >
      <span className={cn("inline-flex items-center gap-1.5 text-sm", ready ? "font-medium text-primary" : "text-muted-foreground")}>
        <Arrow className="h-4 w-4" />
        {ready ? `Release for ${label}` : `Pull for ${label}`}
      </span>
      <span className="max-w-full truncate text-sm">{title}</span>
    </div>
  );
}

function Gone({ tripId }) {
  return (
    <Card className="mx-4 mt-6 flex flex-col items-center gap-3 p-8 text-center">
      <p className="font-medium">This isn’t on the trip any more</p>
      <p className="text-sm text-muted-foreground">Someone may have deleted it.</p>
      <Link to={`/trips/${tripId}`} className={buttonVariants({ variant: "outline" })}>
        Back to the trip
      </Link>
    </Card>
  );
}

function EntrySkeleton() {
  return (
    <div aria-label="Loading" className="flex flex-col gap-4 px-4 pt-6">
      <div className="h-40 animate-pulse rounded-lg bg-card" />
      <div className="h-8 w-2/3 animate-pulse rounded-md bg-card" />
      <div className="h-16 animate-pulse rounded-md bg-card" />
    </div>
  );
}

/**
 * An activity's, stay's or leg's own page (`kind`), by id: Run stage 13.
 * Reads the loaded trip (or the phone's saved copy), so it works offline.
 * ← (in ☰'s place) goes back where you came from, else to its day. Pulling
 * past the top or bottom moves to the day's previous or next entry, never
 * into another day (Run stage 14).
 */
export function EntryPage({ kind }) {
  const { tripId, id } = useParams();
  // The timeline row this was opened from, telling a stay's check-in from
  // its check-out (absent after a reload: then it's the record's first row).
  const location = useLocation();
  const { atKey = null, came = null } = location.state ?? {};
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);
  const online = useSelector(selectOnline);
  const readOnly = useSelector(selectReadOnly);
  // A viewer never edits, so gets no actions at all (offline only greys them).
  const isViewer = useSelector(selectIsViewer);

  // Also re-runs when the connection changes (see TripTimelinePage).
  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId, online]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;
  const found = current ? findEntry(current, kind, id) : null;
  // Pulling moves through the day as it shows on this phone: plan B's
  // activities on a day switched to plan B (Run stage 25). An activity's own
  // day follows the plan it's in, however it was opened.
  const choices = usePlanChoices();
  const ownDay = found?.kind === "activity" ? found.date : null;
  const ownPlanB = Boolean(found?.planB);
  const steps = useMemo(
    () =>
      current
        ? entrySequence(current, {
            planB: (d) => (d === ownDay ? ownPlanB : !isViewer && showsPlanB(current.id, d, choices)),
          })
        : [],
    [current, ownDay, ownPlanB, isViewer, choices]
  );
  const { at, prev, next } = neighbours(steps, kind, id, atKey);
  // ← goes back where you came from; opened directly, to the entry's day.
  const back = found ? `/trips/${tripId}/days/${at?.date ?? found.date}` : `/trips/${tripId}`;

  // Moving to another entry keeps this page mounted: start it at the top.
  const wrapRef = useRef(null);
  useEffect(() => {
    const root = wrapRef.current?.closest("[data-scroll-root]");
    if (root) root.scrollTop = 0;
  }, [kind, id]);

  // Pull past the top or bottom to move (Run stage 14). Moving replaces the
  // address, like swiping between days, so Back isn't a list of every entry
  // passed; `atKey` says which of a stay's or leg's rows it is.
  const go = (step, direction) =>
    navigate(entryPath(tripId, step.kind, step.id), {
      replace: true,
      state: keepFirstEntry(location, { atKey: step.key, came: direction }),
    });
  const pull = useEdgePull(wrapRef, {
    hasPrev: Boolean(found && prev),
    hasNext: Boolean(found && next),
    onPrev: () => go(prev, "prev"),
    onNext: () => go(next, "next"),
  });
  const offset = pull.dir === "prev" ? pullOffset(pull.distance) : -pullOffset(pull.distance);

  let body;
  if (found)
    body = (
      // Keyed, so moving to another entry starts afresh (no old photo while
      // the new one loads, no dialog state carried over) and slides in from
      // the way you went.
      <div
        key={`${kind}-${id}`}
        className={cn(
          came && "animate-in fade-in duration-200 motion-reduce:animate-none",
          came === "next" && "slide-in-from-bottom-8",
          came === "prev" && "slide-in-from-top-8"
        )}
      >
        <EntryView trip={current} found={found} online={online}>
          {!isViewer && <EntryActions trip={current} found={found} readOnly={readOnly} />}
        </EntryView>
      </div>
    );
  else if (current) body = <Gone tripId={tripId} />;
  else if (status === "notFound") body = <Gone tripId={tripId} />;
  else if (status === "failed")
    body = (
      <Card className="mx-4 mt-6 flex flex-col items-center gap-3 p-8 text-center">
        <p className="font-medium">Couldn’t load this trip</p>
        <Button variant="outline" onClick={() => dispatch(fetchTrip(tripId))}>
          Try again
        </Button>
      </Card>
    );
  else body = <EntrySkeleton />;

  return (
    <BottomNavLayout tripId={tripId} back={back}>
      {/* Follows the finger while pulling; springs back when let go. */}
      <div
        ref={wrapRef}
        className={cn("relative mx-auto max-w-2xl", !pull.dir && "transition-transform duration-200 motion-reduce:transition-none")}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
      >
        {pull.dir && (
          <PullHint
            trip={current}
            dir={pull.dir}
            distance={pull.distance}
            step={pull.dir === "prev" ? prev : next}
          />
        )}
        {body}
      </div>
    </BottomNavLayout>
  );
}
