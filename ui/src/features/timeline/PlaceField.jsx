import { useEffect, useId, useRef, useState } from "react";
import { Clock, MapPin, Search, X } from "lucide-react";
import { MiniMap } from "@/shared/components/MiniMap";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { createPlacesSearch } from "@/shared/services/googlePlaces";
import { usePlaceZone } from "@/shared/services/timezoneLookup";
import { zoneLabel } from "@/shared/utils/time";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

/**
 * Pick a place: type, choose a Google suggestion, then rename it if you like
 * (the coordinates stay). The place decides which clock its times are on —
 * shown read-only underneath; there is never a timezone picker.
 *
 * If place search is unavailable (no key, or Google failed to load), the name
 * can be typed by hand; times then use `fallbackZone`.
 *
 * `value` is a location ({ name, address?, lat?, lng?, placeId?, ... }) or null.
 */
export function PlaceField({ label, value, onChange, error, near, fallbackZone, hint }) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const searchRef = useRef(null); // one search session per field
  const zone = usePlaceZone(value);

  // The bias point by value, so a parent re-render doesn't re-run the search.
  const nearLat = near?.lat;
  const nearLng = near?.lng;

  // Debounced suggestions while typing.
  useEffect(() => {
    if (value || unavailable || query.trim().length < MIN_CHARS) {
      setSuggestions([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        searchRef.current ??= await createPlacesSearch();
        const bias = nearLat != null ? { lat: nearLat, lng: nearLng } : undefined;
        const results = await searchRef.current.suggest(query.trim(), bias);
        if (live) {
          setSuggestions(results);
          setOpen(true);
        }
      } catch {
        if (live) setUnavailable(true);
      } finally {
        if (live) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, value, unavailable, nearLat, nearLng]);

  async function choose(suggestion) {
    setOpen(false);
    try {
      const place = await searchRef.current.pick(suggestion);
      delete place.types; // Google's place types aren't part of a stored location
      onChange(place);
      setQuery("");
    } catch {
      setUnavailable(true);
    }
  }

  const inputId = `${ids}-input`;
  const listId = `${ids}-list`;
  const errorId = `${ids}-error`;

  if (value) {
    const located = value.lat != null && value.lng != null;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>{label}</Label>
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <Input
              id={inputId}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              className="h-8"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => onChange(null)}
              aria-label={`Change ${label.toLowerCase()}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {value.address && <p className="pl-6 text-xs text-muted-foreground">{value.address}</p>}
          {located && <MiniMap lat={value.lat} lng={value.lng} className="h-28 w-full" />}
          <p className="flex items-center gap-1.5 pl-6 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
            {located
              ? zone
                ? `Times here are ${zoneLabel(zone)} time`
                : "Working out the local time…"
              : `Not on the map, so times use ${zoneLabel(fallbackZone)} time`}
          </p>
        </div>
        {error && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="Search for a place"
          className="pl-8"
          autoComplete="off"
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="z-20 max-h-56 overflow-y-auto rounded-md border border-border bg-card"
        >
          {suggestions.map((s) => (
            <li key={s.placeId} role="option" aria-selected="false">
              <button
                type="button"
                onClick={() => choose(s)}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="text-sm">{s.primary}</span>
                {s.secondary && <span className="text-xs text-muted-foreground">{s.secondary}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
      {unavailable && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Place search is unavailable.</span>
          {query.trim() && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ name: query.trim() })}
            >
              Use “{query.trim()}” as typed
            </Button>
          )}
        </div>
      )}
      {hint && !error && !unavailable && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
