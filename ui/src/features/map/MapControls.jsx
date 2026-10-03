import { useEffect, useRef, useState } from "react";
import { CalendarDays, Home, MapPinPlus, Search, X } from "lucide-react";
import { iconFor } from "@/features/map/mapStyle";
import { matchMarkers } from "@/features/map/markerSearch";
import { searchRows } from "@/features/map/searchRows";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { createPlacesSearch } from "@/shared/services/googlePlaces";
import { cn } from "@/shared/utils/cn";
import { formatDayHeading } from "@/shared/utils/time";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;
const MAX_TRIP_ROWS = 8;

function SectionHeading({ children }) {
  return (
    <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </li>
  );
}

function Row({ row, onPick }) {
  const isTrip = row.type === "trip";
  const Icon = isTrip ? iconFor(row.marker) : MapPinPlus;
  const title = isTrip ? row.marker.title : row.suggestion.primary;
  const subtitle = isTrip ? row.marker.city : row.suggestion.secondary;
  return (
    <li role="option" aria-selected="false">
      <button
        type="button"
        onClick={() => onPick(row)}
        className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <Icon
          className={cn("mt-0.5 h-4 w-4 shrink-0", isTrip ? "text-muted-foreground" : "text-primary")}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm">{title}</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </span>
        {!isTrip && (
          <span className="shrink-0 rounded-sm border border-primary/50 px-1.5 text-[11px] font-medium text-primary">
            New
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Search box + House/Calendar filters, overlaid on the map.
 *
 * Suggestions come in two sections, never interleaved: the trip's own
 * (currently filtered-in) places first, then Google's places — marked "New",
 * since they aren't on the trip — biased to what the map is showing. Only the
 * typed text goes to Google, and only while online. Enter picks the first row.
 *
 * `onSelectMarker(marker)` for a trip row; `onPickPlace(place)` for a Google
 * row, with the place's details (and Google `types`) already fetched.
 * `resultName`: the picked Google place currently shown on the map, if any —
 * the box then shows it, with an × that clears it (`onClearResult`).
 */
export function MapControls({
  trip,
  markers,
  visibleMarkers,
  onSelectMarker,
  onPickPlace,
  getBias,
  online = true,
  resultName = null,
  onClearResult,
  stayOnly,
  onToggleStayOnly,
  date,
  onDateChange,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const dateInputRef = useRef(null);
  const searchRef = useRef(null); // one Google search session for this box

  const trimmed = query.trim();
  const searchGoogle = online && !unavailable;

  // Debounced Google suggestions while typing (3+ characters).
  useEffect(() => {
    if (!searchGoogle || trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        searchRef.current ??= await createPlacesSearch();
        const results = await searchRef.current.suggest(trimmed, getBias?.());
        if (live) setSuggestions(results);
      } catch {
        if (live) setUnavailable(true); // no key / failed to load: trip rows only
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getBias is read at fire time, not a trigger
  }, [trimmed, searchGoogle]);

  const tripMatches = trimmed ? matchMarkers(visibleMarkers, trimmed).slice(0, MAX_TRIP_ROWS) : [];
  const rows = trimmed ? searchRows(tripMatches, searchGoogle ? suggestions : [], markers) : [];
  const tripRows = rows.filter((r) => r.type === "trip");
  const placeRows = rows.filter((r) => r.type === "place");

  async function pick(row) {
    setOpen(false);
    if (row.type === "trip") {
      setQuery("");
      onSelectMarker(row.marker);
      return;
    }
    try {
      const place = await searchRef.current.pick(row.suggestion);
      setQuery("");
      onPickPlace(place);
    } catch {
      setUnavailable(true);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (rows[0]) pick(rows[0]);
  }

  function clear() {
    setQuery("");
    setOpen(false);
    onClearResult?.();
  }

  const showingResult = !query && resultName;

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-1.5 p-2">
      <form onSubmit={handleSubmit} className="relative flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-label="Search trip or places"
          value={showingResult ? resultName : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (showingResult) setQuery("");
            setOpen(true);
          }}
          placeholder={online ? "Search trip or places" : "Search this trip"}
          className={cn("bg-card pl-8", (query || resultName) && "pr-8")}
          autoComplete="off"
        />
        {(query || resultName) && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-1 top-1 rounded-sm p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {open && rows.length > 0 && (
          <ul
            role="listbox"
            aria-label="Matching places"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-card pb-1"
          >
            {tripRows.length > 0 && <SectionHeading>On this trip</SectionHeading>}
            {tripRows.map((row) => (
              <Row key={row.key} row={row} onPick={pick} />
            ))}
            {placeRows.length > 0 && <SectionHeading>New places</SectionHeading>}
            {placeRows.map((row) => (
              <Row key={row.key} row={row} onPick={pick} />
            ))}
          </ul>
        )}
      </form>

      <Button
        type="button"
        variant={stayOnly ? "default" : "ghost"}
        size="icon"
        className="shrink-0 bg-card"
        aria-pressed={stayOnly}
        aria-label="Show only stays"
        onClick={onToggleStayOnly}
      >
        <Home className="h-4 w-4" aria-hidden="true" />
      </Button>

      {date ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          className="shrink-0 gap-1"
          aria-label={`Showing ${formatDayHeading(date)} only; clear`}
          onClick={() => onDateChange("")}
        >
          {formatDayHeading(date)}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : (
        <div className="relative shrink-0">
          <Button
            type="button"
            variant={calendarOpen ? "default" : "ghost"}
            size="icon"
            className="bg-card"
            aria-pressed={calendarOpen}
            aria-label="Show one day"
            onClick={() => {
              setCalendarOpen((o) => !o);
              requestAnimationFrame(() => dateInputRef.current?.focus());
            }}
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </Button>
          <input
            ref={dateInputRef}
            type="date"
            aria-label="Pick a day"
            min={trip.startDate}
            max={trip.endDate}
            className={cn(
              "absolute right-0 top-full mt-1 rounded-md border border-border bg-card px-2 py-1 text-sm",
              !calendarOpen && "sr-only"
            )}
            onChange={(e) => {
              onDateChange(e.target.value);
              setCalendarOpen(false);
            }}
            onBlur={() => setCalendarOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
