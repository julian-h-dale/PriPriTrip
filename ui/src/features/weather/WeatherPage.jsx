import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { AlertTriangle, CloudOff, Droplets, Sunrise, Sunset, Wind } from "lucide-react";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { fetchWeather } from "@/features/weather/weatherSlice";
import { percent, placeTime, rainInches, toC, toF, toMph } from "@/features/weather/units";
import { weatherIcon } from "@/features/weather/weatherIcon";
import { ToolLayout } from "@/shared/components/ToolLayout";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { formatAgo, formatDayHeading } from "@/shared/utils/time";
import { useTrackOnce } from "@/shared/analytics/useAnalytics";

function Temp({ c, className }) {
  if (c == null) return null;
  return (
    <span className={className}>
      {toF(c)}°<span className="ml-0.5 text-[0.6em] font-normal text-muted-foreground">{toC(c)}°C</span>
    </span>
  );
}

function Stat({ icon: Icon, children, label }) {
  if (children == null || children === false) return null;
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      {children}
    </span>
  );
}

function Today({ now }) {
  const Icon = weatherIcon(now.icon);
  return (
    <Card aria-label="Right now" role="region" className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Right now · {now.place}</p>
          <p className="mt-1 text-4xl font-semibold">
            <Temp c={now.temp} />
          </p>
          <p className="text-sm capitalize text-muted-foreground">{now.description ?? now.condition}</p>
        </div>
        <Icon className="h-12 w-12 shrink-0 text-primary" aria-hidden="true" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {now.feelsLike != null && <span>Feels like {toF(now.feelsLike)}°</span>}
        <Stat icon={Droplets} label="Humidity">
          {now.humidity != null && `${now.humidity}%`}
        </Stat>
        <Stat icon={Wind} label="Wind">
          {now.windSpeed != null && `${toMph(now.windSpeed)} mph`}
        </Stat>
        {now.uvi != null && <span>UV {Math.round(now.uvi)}</span>}
        <Stat icon={Sunrise} label="Sunrise">
          {placeTime(now.sunrise, now.zone)}
        </Stat>
        <Stat icon={Sunset} label="Sunset">
          {placeTime(now.sunset, now.zone)}
        </Stat>
      </div>
    </Card>
  );
}

function DayRow({ day }) {
  const heading = formatDayHeading(day.date);
  if (day.kind === "past" || day.kind === "unavailable") {
    return (
      <li className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
        <span>
          {heading}
          {day.place && ` · ${day.place}`}
        </span>
        <span className="text-xs">{day.kind === "past" ? "Past" : "No forecast yet"}</span>
      </li>
    );
  }
  const Icon = day.kind === "forecast" ? weatherIcon(day.icon) : null;
  const rain = [percent(day.pop), rainInches(day.rain)].filter(Boolean).join(" · ");
  return (
    <li>
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{heading}</p>
            <p className="text-xs text-muted-foreground">
              {day.place}
              {day.kind === "outlook" && " · Long-range outlook"}
            </p>
          </div>
          {Icon && <Icon className="h-7 w-7 shrink-0 text-primary" aria-hidden="true" />}
          <p className="shrink-0 text-right text-sm">
            <Temp c={day.high} className="font-semibold" />
            <span className="text-muted-foreground"> / </span>
            <Temp c={day.low} className="text-muted-foreground" />
          </p>
        </div>
        {(day.summary || day.description) && (
          <p className="text-xs text-muted-foreground first-letter:uppercase">{day.summary ?? day.description}</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Stat icon={Droplets} label="Rain">
            {rain || null}
          </Stat>
          <Stat icon={Wind} label="Wind">
            {day.windSpeed != null &&
              `${toMph(day.windSpeed)} mph${day.windGust != null ? `, gusts ${toMph(day.windGust)}` : ""}`}
          </Stat>
          {day.uvi != null && <span>UV {Math.round(day.uvi)}</span>}
          {day.humidity != null && <span>{day.humidity}% humidity</span>}
          <Stat icon={Sunrise} label="Sunrise">
            {placeTime(day.sunrise, day.zone)}
          </Stat>
          <Stat icon={Sunset} label="Sunset">
            {placeTime(day.sunset, day.zone)}
          </Stat>
        </div>
      </Card>
    </li>
  );
}

function Alerts({ alerts }) {
  if (!alerts?.length) return null;
  return (
    <section aria-label="Weather alerts" className="flex flex-col gap-2">
      {alerts.map((a) => (
        <Card key={`${a.event}-${a.start}`} className="flex gap-2 border-warning/50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {a.event} · {a.place}
            </p>
            {a.sender && <p className="text-xs text-muted-foreground">{a.sender}</p>}
            {a.description && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{a.description}</p>}
          </div>
        </Card>
      ))}
    </section>
  );
}

export function WeatherPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const online = useSelector((s) => s.network?.online ?? true);
  const { data, savedAt, status, stale, tripId: loadedId } = useSelector((s) => s.weather);
  const tripName = useSelector((s) => (s.timeline?.trip?.id === tripId ? s.timeline.trip.name : null));
  const weather = loadedId === tripId ? data : null;
  useTrackOnce("weather-view", Boolean(weather)); // a forecast on screen, once a visit

  useEffect(() => {
    dispatch(fetchTrip(tripId)); // for its name in the top bar
    dispatch(fetchWeather(tripId));
  }, [dispatch, tripId, online]);
  // How old the forecast itself is (the server keeps it up to 12 hours).
  const updatedAt = weather?.today?.fetchedAt ?? weather?.days?.find((d) => d.fetchedAt)?.fetchedAt ?? savedAt;

  let body;
  if (!weather) {
    body =
      status === "failed" ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <CloudOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Couldn’t load the weather</p>
          <p className="text-sm text-muted-foreground">
            {online ? "Try again in a moment." : "Connect once to get the forecast; it’s kept for offline after that."}
          </p>
        </Card>
      ) : (
        <div aria-label="Loading weather" className="flex flex-col gap-2">
          <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
          <div className="h-20 animate-pulse rounded-lg border border-border bg-card" />
          <div className="h-20 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      );
  } else if (!weather.configured) {
    body = (
      <Card className="flex flex-col items-center gap-2 p-8 text-center">
        <CloudOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">Weather isn’t set up</p>
        <p className="text-sm text-muted-foreground">
          The server needs an OpenWeatherMap key (OPENWEATHER_API_KEY) to show forecasts.
        </p>
      </Card>
    );
  } else {
    const upcoming = weather.days.filter((d) => d.kind !== "past");
    const past = weather.days.length - upcoming.length;
    body = (
      <>
        {weather.problem && (
          <p role="status" className="rounded-md border border-warning/40 px-3 py-2 text-xs text-warning">
            Some weather couldn’t be updated: {weather.problem}.
          </p>
        )}
        <Alerts alerts={weather.alerts} />
        {weather.today && <Today now={weather.today} />}
        <section aria-label="Trip days" className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trip days</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">This trip is over.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {upcoming.map((day) => (
                <DayRow key={day.date} day={day} />
              ))}
            </ol>
          )}
          {past > 0 && upcoming.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {past} {past === 1 ? "day" : "days"} already past.
            </p>
          )}
        </section>
        <p className="text-xs text-muted-foreground">
          Forecasts reach 8 days ahead; further out is OpenWeatherMap’s long-range outlook, a rough guide.
        </p>
      </>
    );
  }

  return (
    <ToolLayout tripId={tripId} title={tripName ?? ""}>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Weather</h1>
        {weather?.configured && updatedAt && (
          <p className={cn("text-xs", stale || !online ? "text-warning" : "text-muted-foreground")}>
            Updated {formatAgo(updatedAt)}
            {!online && " · offline"}
          </p>
        )}
      </header>
      {body}
    </ToolLayout>
  );
}
