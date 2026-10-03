import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { CalendarDays, Home, Search, X } from "lucide-react";
import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import { filterMarkers } from "@/features/map/mapFilters";
import { matchMarkers } from "@/features/map/markerSearch";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { getClientConfig } from "@/shared/services/clientConfig";
import { loadGoogleMapsLibrary } from "@/shared/services/googleMapsLoader";
import { cn } from "@/shared/utils/cn";
import { formatDayHeading } from "@/shared/utils/time";

// A plain emoji glyph per kind/mode — simple, legible on a small pin, no
// per-icon SVG to hand-build for a non-React marker. Easy to swap for a real
// icon later if that's worth it.
const TRAVEL_GLYPH = { flight: "✈️", train: "🚆", bus: "🚌", ferry: "🚢", boat: "🚢", car: "🚗", other: "🧭" };

function glyphFor(marker) {
  if (marker.kind === "stay") return "🏨";
  if (marker.kind === "travel") return TRAVEL_GLYPH[marker.mode] ?? "🧭";
  return "📍";
}

function colorFor(marker) {
  if (marker.kind === "stay") return "#3987e5"; // --series-1
  if (marker.kind === "travel") return "#d95926"; // --series-2
  return "#9085e9"; // --series-7, activities
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function infoWindowHtml(marker, tripId) {
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${marker.lat},${marker.lng}`;
  const dayUrl = `/trips/${tripId}/days/${marker.day}`;
  const photo = marker.imgRef
    ? `<img src="${escapeHtml(marker.imgRef)}" alt="" style="width:100%;height:96px;object-fit:cover;border-radius:6px;margin-bottom:6px;display:block;" />`
    : "";
  // The InfoWindow's own chrome is always a plain white card, regardless of
  // this app's dark theme — this content is rendered outside the React tree
  // (Google appends it directly), so it doesn't inherit our theme at all,
  // but the page's global `color` rule on <body> still cascades down to it.
  // Every text color here is explicit so it reads on that white background
  // instead of inheriting this app's near-white foreground color.
  return `
    <div style="max-width:220px; color:#202124;">
      ${photo}
      <div style="font-weight:600;margin-bottom:2px;color:#202124;">${escapeHtml(marker.title)}</div>
      <div style="font-size:12px;color:#5f6368;margin-bottom:6px;">${formatDayHeading(marker.day)}</div>
      <a href="${dayUrl}" style="display:block;font-size:13px;margin-bottom:2px;color:#1a73e8;">View day</a>
      <a href="${directions}" target="_blank" rel="noopener noreferrer" style="display:block;font-size:13px;color:#1a73e8;">Directions</a>
    </div>
  `;
}

function MissingConfig({ message }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-sm p-6 text-center text-sm text-muted-foreground">{message}</Card>
    </div>
  );
}

/**
 * Search box + House/Calendar filters, overlaid on the map. Search looks at
 * the trip's own (currently filtered-in) markers first; only falls back to
 * a live Places search — to re-center the map for orientation, never adding
 * anything — when nothing local matches.
 */
function MapControls({ trip, visibleMarkers, onSelectMarker, onPanTo, placesLib, stayOnly, onToggleStayOnly, date, onDateChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const dateInputRef = useRef(null);

  const suggestions = query.trim() ? matchMarkers(visibleMarkers, query).slice(0, 8) : [];

  function pick(marker) {
    setQuery("");
    setOpen(false);
    onSelectMarker(marker);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (suggestions.length > 0) {
      pick(suggestions[0]);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed || !placesLib) return;
    try {
      const { places } = await placesLib.Place.searchByText({
        textQuery: trimmed,
        fields: ["location"],
      });
      const hit = places?.[0];
      if (hit?.location) onPanTo(hit.location);
    } catch {
      // Best-effort orientation search only; nothing to show on failure.
    }
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-1.5 p-2">
      <form onSubmit={handleSubmit} className="relative flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-label="Search this trip"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search this trip"
          className="bg-card pl-8"
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <ul role="listbox" aria-label="Matching places" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card">
            {suggestions.map((m) => (
              <li key={m.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => pick(m)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="text-sm">{m.title}</span>
                  {m.city && <span className="text-xs text-muted-foreground">{m.city}</span>}
                </button>
              </li>
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

/** The full-screen map: one marker per located stay, travel endpoint and activity. */
function TripMap({ trip }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const entriesRef = useRef([]); // [{ element, data }]
  const libsRef = useRef(null); // { AdvancedMarkerElement, PinElement }, set once the map is ready
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [placesLib, setPlacesLib] = useState(null);
  const [stayOnly, setStayOnly] = useState(false);
  const [date, setDate] = useState("");
  const markers = useMemo(() => buildMapMarkers(trip), [trip]);

  useEffect(() => {
    getClientConfig()
      .then(setConfig)
      .catch(() => setError("Couldn’t load map configuration."));
  }, []);

  function openInfoWindow(marker, advanced) {
    if (!infoWindowRef.current || !mapRef.current) return;
    infoWindowRef.current.setContent(infoWindowHtml(marker, trip.id));
    infoWindowRef.current.open({ map: mapRef.current, anchor: advanced });
  }

  useEffect(() => {
    if (!config?.googleMapsApiKey || !config?.googleMapsMapId || !containerRef.current) return undefined;
    let live = true;

    (async () => {
      try {
        const { Map, InfoWindow } = await loadGoogleMapsLibrary("maps");
        const { AdvancedMarkerElement, PinElement } = await loadGoogleMapsLibrary("marker");
        const places = await loadGoogleMapsLibrary("places");
        if (!live || !containerRef.current) return;

        // Fit the initial view to stays/activities — the trip's actual
        // destinations — not travel's endpoints, which are often a
        // continent away (an international flight's departure airport
        // would otherwise zoom the map out to show the whole ocean).
        const anchorMarkers = markers.filter((m) => m.kind !== "travel");
        const forBounds = anchorMarkers.length ? anchorMarkers : markers;

        const map = new Map(containerRef.current, {
          mapId: config.googleMapsMapId,
          center: forBounds[0] ? { lat: forBounds[0].lat, lng: forBounds[0].lng } : { lat: 0, lng: 0 },
          zoom: forBounds.length ? 12 : 2,
        });
        mapRef.current = map;
        infoWindowRef.current = new InfoWindow();
        setPlacesLib(places);

        const bounds = new window.google.maps.LatLngBounds();
        forBounds.forEach((marker) => bounds.extend({ lat: marker.lat, lng: marker.lng }));
        if (forBounds.length > 1) map.fitBounds(bounds);

        libsRef.current = { AdvancedMarkerElement, PinElement };
        if (live) setReady(true);
      } catch {
        if (live) setError("Couldn’t load Google Maps.");
      }
    })();

    return () => {
      live = false;
      entriesRef.current.forEach(({ element }) => (element.map = null));
      entriesRef.current = [];
      infoWindowRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markers derive from trip, stable per trip load
  }, [config, trip.id]);

  // Rebuild the marker elements (not just toggle .map) whenever the filtered
  // set changes. Toggling `.map` on existing elements was simpler, but a
  // real Google Maps quirk surfaced under test: when two markers share the
  // exact same coordinates (routine for a round trip — an airport appears on
  // both the outbound and return leg), detaching and reattaching them drops
  // one of them permanently. Full teardown-and-recreate per filter change
  // sidesteps that; the map instance, its bounds and the InfoWindow are
  // untouched, so this doesn't re-fit or jump the view.
  useEffect(() => {
    if (!ready || !libsRef.current || !mapRef.current) return;
    const { AdvancedMarkerElement, PinElement } = libsRef.current;
    const map = mapRef.current;

    entriesRef.current.forEach(({ element }) => (element.map = null));
    entriesRef.current = filterMarkers(markers, { stayOnly, date: date || null }).map((marker) => {
      const color = colorFor(marker);
      const pin = new PinElement({
        background: color,
        borderColor: color,
        glyphColor: "#fff",
        glyphText: glyphFor(marker),
      });
      const advanced = new AdvancedMarkerElement({
        map,
        position: { lat: marker.lat, lng: marker.lng },
        title: marker.title,
        content: pin,
      });
      // AdvancedMarkerElement's own runtime recommends addListener("click")
      // specifically (not the generic "gmp-click" event) for the built-in
      // keyboard/accessible click handling.
      advanced.addListener("click", () => openInfoWindow(marker, advanced));
      return { element: advanced, data: marker };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openInfoWindow closes over refs only, stable in effect
  }, [ready, markers, stayOnly, date]);

  const visibleMarkers = useMemo(
    () => filterMarkers(markers, { stayOnly, date: date || null }),
    [markers, stayOnly, date]
  );

  function selectMarker(marker) {
    const entry = entriesRef.current.find((e) => e.data.id === marker.id);
    if (!entry || !mapRef.current) return;
    mapRef.current.panTo({ lat: marker.lat, lng: marker.lng });
    mapRef.current.setZoom(15);
    openInfoWindow(marker, entry.element);
  }

  function panTo(position) {
    mapRef.current?.panTo(position);
    mapRef.current?.setZoom(13);
  }

  if (error) return <MissingConfig message={error} />;
  if (config && !config.googleMapsApiKey) {
    return <MissingConfig message="No Google Maps key is configured yet." />;
  }
  if (config && !config.googleMapsMapId) {
    return (
      <MissingConfig message="No Map ID is configured yet — the map view needs one for its markers. See implementation_plan.md's Key setup." />
    );
  }
  if (markers.length === 0 && config) {
    return <MissingConfig message="No located places on this trip yet." />;
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {ready && (
        <MapControls
          trip={trip}
          visibleMarkers={visibleMarkers}
          onSelectMarker={selectMarker}
          onPanTo={panTo}
          placesLib={placesLib}
          stayOnly={stayOnly}
          onToggleStayOnly={() => setStayOnly((v) => !v)}
          date={date}
          onDateChange={setDate}
        />
      )}
    </div>
  );
}

export function MapPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);

  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  return (
    <BottomNavLayout tripId={tripId}>
      {current ? (
        <TripMap key={current.id} trip={current} />
      ) : status === "notFound" || status === "failed" ? (
        <MissingConfig message="Couldn’t load this trip." />
      ) : (
        <MissingConfig message="Loading…" />
      )}
    </BottomNavLayout>
  );
}
