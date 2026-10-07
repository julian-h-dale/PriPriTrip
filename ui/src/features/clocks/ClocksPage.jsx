import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { Moon, Smartphone, Sun } from "lucide-react";
import { compareToPhone, formatUtcOffset, offsetMinutes, phoneZone, readClock } from "@/features/clocks/clock";
import { tripZones, zoneTitle } from "@/features/clocks/tripZones";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { ToolLayout } from "@/shared/components/ToolLayout";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { zoneLabel } from "@/shared/utils/time";
import { useTrackOnce } from "@/shared/analytics/useAnalytics";

/** Now, moving on every second while the page is open. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Clock({ title, zone, now, here, mine, phoneOffset }) {
  const clock = readClock(zone, now);
  const offset = offsetMinutes(zone, now);
  const day = clock.hour24 >= 6 && clock.hour24 < 18;
  const DayIcon = day ? Sun : Moon;
  return (
    <Card role="region" aria-label={title} className={cn("flex items-center justify-between gap-3 p-4", here && "border-primary/60")}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="inline-flex items-center gap-1.5 break-words text-sm font-semibold">
          {mine && <Smartphone className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
          {title}
        </p>
        <p className="text-xs text-muted-foreground">
          {[here ? "You’re here" : !mine && compareToPhone(offset - phoneOffset), formatUtcOffset(offset)].filter(Boolean).join(" · ")}
        </p>
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <DayIcon className={cn("h-3.5 w-3.5", day ? "text-warning" : "text-primary")} aria-hidden="true" />
          {clock.date}
        </p>
      </div>
      <p className="shrink-0 text-right font-mono tabular-nums" aria-label={`${clock.time} ${clock.period}`}>
        <span className="text-4xl font-semibold leading-none">{clock.time}</span>
        <span className="ml-1 text-sm text-muted-foreground">{clock.seconds}</span>
        <span className="ml-1 text-sm font-medium">{clock.period}</span>
      </p>
    </Card>
  );
}

/**
 * Time zones (a trip tool, in the drawer): a live digital clock for every
 * zone the trip passes through, in trip order, beside the phone's own.
 * Worked out on the phone, so it works offline.
 */
export function ClocksPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const trip = useSelector((s) => (s.timeline?.trip?.id === tripId ? s.timeline.trip : null));
  const now = useNow();

  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId]);

  const mine = phoneZone();
  const zones = trip ? tripZones(trip) : [];
  useTrackOnce("timezones-view", zones.length > 0); // the clocks on screen, once a visit
  const phoneOffset = offsetMinutes(mine, now);
  // On the trip already? Then that zone's clock says so, and there's no separate "this phone" one.
  const hereIndex = zones.findIndex((z) => z.zone === mine);

  return (
    <ToolLayout tripId={tripId} title={trip?.name ?? ""}>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Time zones</h1>
        <p className="text-sm text-muted-foreground">Every time zone on the trip, in the order you reach them.</p>
      </header>
      {!trip ? (
        <div className="flex flex-col gap-3" aria-label="Loading the trip">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <>
          {hereIndex < 0 && <Clock title={`This phone · ${zoneLabel(mine)}`} zone={mine} now={now} mine phoneOffset={phoneOffset} />}
          <section aria-label="The trip's time zones" className="flex flex-col gap-3">
            {hereIndex < 0 && (
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On the trip</h2>
            )}
            {zones.map((z, i) => (
              <Clock key={z.zone} title={zoneTitle(z)} zone={z.zone} now={now} here={i === hereIndex} phoneOffset={phoneOffset} />
            ))}
          </section>
        </>
      )}
    </ToolLayout>
  );
}
