import { useEffect, useRef, useState } from "react";
import { BedDouble, CalendarDays, Check, Filter, Layers, LocateFixed, MapPinned, MapPinPlus, NotebookPen, Search, X } from "lucide-react";
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
    <li role="presentation" className="px-3 pb-1 pt-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
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
          <span className="shrink-0 rounded-sm border border-primary/50 px-1.5 text-[0.6875rem] font-medium text-primary">
            New
          </span>
        )}
      </button>
    </li>
  );
}

/** What the map can show, one at a time (Q-F1). `value` is MapPage's `only`. */
const MAP_FILTERS = [
  { value: null, label: "Everything", icon: Layers },
  { value: "stays", label: "Stays", icon: BedDouble },
  { value: "pois", label: "Points of interest", icon: MapPinned },
  { value: "memories", label: "Journal", icon: NotebookPen },
];

/**
 * One Filter button for what the map shows (Run stage 16): Everything (the
 * trip's places and points of interest), Stays, Points of interest or
 * Journal. While anything but Everything is on, the button is filled and
 * shows that filter's icon, so a filtered map is never a surprise.
 * A viewer's map has only activities and public memories (the server sends
 * them nothing else), so they get Everything and Journal.
 */
function FilterMenu({ only, onOnlyChange, isViewer = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const filters = isViewer ? MAP_FILTERS.filter((f) => f.value === null || f.value === "memories") : MAP_FILTERS;
  const active = filters.find((f) => f.value === only) ?? filters[0];
  const filtered = active.value !== null;
  const Icon = filtered ? active.icon : Filter;

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <Button
        type="button"
        variant={filtered ? "default" : "ghost"}
        size="icon"
        // bg-card only when off: it would otherwise hide the filled state.
        className={cn(!filtered && "bg-card")}
        aria-label={filtered ? `Filter the map: ${active.label}` : "Filter the map"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && (
        <ul
          role="menu"
          aria-label="Show on the map"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card py-1"
        >
          {filters.map((f) => {
            const checked = f.value === active.value;
            const ItemIcon = f.icon;
            return (
              <li key={f.label} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  onClick={() => {
                    setOpen(false);
                    onOnlyChange(f.value);
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <ItemIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1">{f.label}</span>
                  {checked && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Search box + Filter + Calendar + Locate, overlaid on the map. The Filter
 * menu shows one kind at a time (`only`: null for everything, "stays",
 * "pois" or "memories"); everything is the trip's places and points of
 * interest, not memories.
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
  only = null,
  onOnlyChange,
  onLocate,
  locating = false,
  date,
  onDateChange,
  isViewer = false,
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

      <FilterMenu only={only} onOnlyChange={onOnlyChange} isViewer={isViewer} />

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
            className={cn(!calendarOpen && "bg-card")}
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

      {onLocate && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 bg-card"
          aria-label="Show where I am"
          aria-busy={locating}
          onClick={onLocate}
        >
          <LocateFixed className={locating ? "h-4 w-4 animate-pulse text-primary" : "h-4 w-4"} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
