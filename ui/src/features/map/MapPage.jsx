import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { CloudOff, Navigation } from "lucide-react";
import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import { MapControls } from "@/features/map/MapControls";
import { MapInfoContent } from "@/features/map/MapInfoContent";
import { filterMarkers } from "@/features/map/mapFilters";
import { colorFor, directionsUrl, glyphFor, iconFor } from "@/features/map/mapStyle";
import { isArea } from "@/features/map/placeActions";
import { ActivityForm } from "@/features/timeline/ActivityForm";
import { stayCoverage } from "@/features/timeline/coverageView";
import { runEdit } from "@/features/timeline/runEdit";
import { StayForm } from "@/features/timeline/StayForm";
import {
  createItem,
  createStay,
  createTravel,
  fetchTrip,
  selectIsViewer,
  selectReadOnly,
} from "@/features/timeline/timelineSlice";
import { TravelForm } from "@/features/timeline/TravelForm";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Card } from "@/shared/components/ui/card";
import { getClientConfig } from "@/shared/services/clientConfig";
import { loadGoogleMapsLibrary } from "@/shared/services/googleMapsLoader";
import { defaultFormDate } from "@/shared/utils/tripDates";
import { formatDayHeading } from "@/shared/utils/time";

function MissingConfig({ message }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-sm p-6 text-center text-sm text-muted-foreground">{message}</Card>
    </div>
  );
}

/**
 * Google Maps can't draw offline, so the map tab becomes a plain list of the
 * trip's places, each with a directions link — those hand off to the phone's
 * Google Maps app, which has its own downloadable offline areas.
 */
function OfflinePlaces({ trip, markers }) {
  const days = [...markers].sort((a, b) => a.day.localeCompare(b.day));
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        The map needs a connection. Directions open in your maps app.
      </p>
      <ul aria-label="Places on this trip" className="flex flex-col gap-2">
        {days.map((m, i) => {
          const Icon = iconFor(m);
          return (
            <li key={`${m.id}:${i}`}>
              <Card className="flex items-center gap-3 p-3">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{m.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDayHeading(m.day)}
                    {m.city ? ` · ${m.city}` : ""}
                  </span>
                </div>
                <a
                  href={directionsUrl(m)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm p-2 text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Directions to ${m.title}`}
                >
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  Directions
                </a>
              </Card>
            </li>
          );
        })}
      </ul>
      {days.length === 0 && (
        <p className="text-sm text-muted-foreground">No located places on {trip.name} yet.</p>
      )}
    </div>
  );
}

// How far below the center a focused marker sits, so its info window opens
// under the search bar instead of behind it.
const FOCUS_OFFSET_PX = 140;

// Which form an Add action opens, and with the picked place at which end.
const ACTION_FORM = {
  activity: { kind: "activity" },
  stay: { kind: "stay" },
  travelFrom: { kind: "travel", end: "from" },
  travelTo: { kind: "travel", end: "to" },
};

/**
 * The full-screen map: one marker per located stay, travel endpoint and
 * activity, plus — after a Google search — one temporary "search result"
 * marker for a place not on the trip, whose info window offers to add it.
 */
function TripMap({ trip }) {
  const dispatch = useDispatch();
  const online = useSelector((s) => s.network?.online ?? true);
  const readOnly = useSelector(selectReadOnly);
  const isViewer = useSelector(selectIsViewer);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const entriesRef = useRef([]); // [{ element, data }]
  const resultMarkerRef = useRef(null); // the search result's AdvancedMarkerElement
  const libsRef = useRef(null); // { AdvancedMarkerElement, PinElement }, set once the map is ready
  // The InfoWindow's content node; React renders into it through a portal.
  const [infoNode] = useState(() => document.createElement("div"));
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [stayOnly, setStayOnly] = useState(false);
  const [date, setDate] = useState("");
  // null | { kind: "trip", marker } | { kind: "place", place, types }
  const [info, setInfo] = useState(null);
  // The picked Google place on the map: null | { place, types }
  const [result, setResult] = useState(null);
  // null | { kind: "activity" | "stay" | "travel", prefill, date }
  const [form, setForm] = useState(null);
  const markers = useMemo(() => buildMapMarkers(trip), [trip]);
  const stayCov = useMemo(() => stayCoverage(trip), [trip]);

  useEffect(() => {
    getClientConfig()
      .then(setConfig)
      .catch(() => setError("Couldn’t load map configuration."));
  }, []);

  function openInfoWindow(next, anchor) {
    if (!infoWindowRef.current || !mapRef.current) return;
    setInfo(next);
    infoWindowRef.current.setContent(infoNode);
    infoWindowRef.current.open({ map: mapRef.current, anchor });
  }

  useEffect(() => {
    if (!config?.googleMapsApiKey || !config?.googleMapsMapId || !containerRef.current) return undefined;
    let live = true;

    (async () => {
      try {
        const { Map, InfoWindow } = await loadGoogleMapsLibrary("maps");
        const { AdvancedMarkerElement, PinElement } = await loadGoogleMapsLibrary("marker");
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
        const infoWindow = new InfoWindow();
        infoWindow.addListener("closeclick", () => setInfo(null));
        infoWindowRef.current = infoWindow;

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
      if (resultMarkerRef.current) resultMarkerRef.current.map = null;
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
      advanced.addListener("click", () => openInfoWindow({ kind: "trip", marker }, advanced));
      return { element: advanced, data: marker };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openInfoWindow closes over refs/setters only
  }, [ready, markers, stayOnly, date]);

  const visibleMarkers = useMemo(
    () => filterMarkers(markers, { stayOnly, date: date || null }),
    [markers, stayOnly, date]
  );

  function selectMarker(marker) {
    const entry = entriesRef.current.find((e) => e.data.id === marker.id);
    if (!entry || !mapRef.current) return;
    focus({ lat: marker.lat, lng: marker.lng });
    openInfoWindow({ kind: "trip", marker }, entry.element);
  }

  /** Center on a point at street zoom, nudged down so its info window clears the controls. */
  function focus(position) {
    const map = mapRef.current;
    map.setZoom(15);
    map.setCenter(position);
    map.panBy(0, -FOCUS_OFFSET_PX);
  }

  function clearResult() {
    if (resultMarkerRef.current) resultMarkerRef.current.map = null;
    resultMarkerRef.current = null;
    setResult(null);
    if (info?.kind === "place") {
      infoWindowRef.current?.close();
      setInfo(null);
    }
  }

  /** A Google place picked from search: drop the search-result marker there and open its info window. */
  function showPlace(picked) {
    const { types = [], ...place } = picked;
    const map = mapRef.current;
    if (!map || !libsRef.current) return;
    if (resultMarkerRef.current) resultMarkerRef.current.map = null;
    resultMarkerRef.current = null;
    const position = { lat: place.lat, lng: place.lng };

    // A city or region is for orientation only: pan there, nothing to add.
    if (isArea(types)) {
      setResult(null);
      infoWindowRef.current?.close();
      setInfo(null);
      map.panTo(position);
      map.setZoom(12);
      return;
    }

    const { AdvancedMarkerElement, PinElement } = libsRef.current;
    // Looks unlike any trip marker: white, dark border, a "+" — not saved yet.
    const pin = new PinElement({
      background: "#ffffff",
      borderColor: "#12151c",
      glyphColor: "#12151c",
      glyphText: "+",
    });
    const marker = new AdvancedMarkerElement({ map, position, title: place.name, content: pin, zIndex: 1000 });
    marker.addListener("click", () => openInfoWindow({ kind: "place", place, types }, marker));
    resultMarkerRef.current = marker;
    setResult({ place, types });
    focus(position);
    openInfoWindow({ kind: "place", place, types }, marker);
  }

  function startAdd(action) {
    if (!info || info.kind !== "place") return;
    const { kind, end } = ACTION_FORM[action];
    setForm({
      kind,
      prefill: { place: info.place, end },
      date: defaultFormDate(trip, {
        preferred: date || null,
        // A new stay should start on a night that has none yet.
        skip: kind === "stay" ? (d) => stayCov.has(d) : undefined,
      }),
    });
  }

  async function save(payload) {
    const tripId = trip.id;
    const thunk =
      form.kind === "stay"
        ? createStay({ tripId, stay: payload })
        : form.kind === "travel"
          ? createTravel({ tripId, travel: payload })
          : createItem({ tripId, item: payload });
    const outcome = await runEdit(dispatch, thunk);
    // Saved: the place is a trip marker now (the trip reloads into state and
    // the markers rebuild), so the temporary search result goes.
    if (outcome.ok) clearResult();
    return outcome;
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

  const formProps = {
    open: true,
    onClose: () => setForm(null),
    trip,
    date: form?.date,
    prefill: form?.prefill,
    onSave: save,
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {ready && (
        <MapControls
          trip={trip}
          markers={markers}
          visibleMarkers={visibleMarkers}
          onSelectMarker={selectMarker}
          onPickPlace={showPlace}
          getBias={() => mapRef.current?.getBounds()?.toJSON()}
          online={online}
          resultName={result?.place.name ?? null}
          onClearResult={clearResult}
          stayOnly={stayOnly}
          onToggleStayOnly={() => setStayOnly((v) => !v)}
          date={date}
          onDateChange={setDate}
        />
      )}
      {info &&
        createPortal(
          <MapInfoContent info={info} tripId={trip.id} onAction={startAdd} readOnly={readOnly} canAdd={!isViewer} />,
          infoNode
        )}

      {form?.kind === "activity" && <ActivityForm {...formProps} item={null} />}
      {form?.kind === "stay" && <StayForm {...formProps} stay={null} />}
      {form?.kind === "travel" && <TravelForm {...formProps} travel={null} />}
    </div>
  );
}

export function MapPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);
  const online = useSelector((s) => s.network?.online ?? true);

  // Also re-runs when the connection changes (see TripTimelinePage).
  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId, online]);

  const current = loadedId === tripId && trip?.id === tripId ? trip : null;
  const markers = useMemo(() => (current ? buildMapMarkers(current) : []), [current]);

  return (
    <BottomNavLayout tripId={tripId}>
      {current && !online ? (
        <OfflinePlaces trip={current} markers={markers} />
      ) : current ? (
        <TripMap key={current.id} trip={current} />
      ) : status === "notFound" || status === "failed" ? (
        <MissingConfig message="Couldn’t load this trip." />
      ) : (
        <MissingConfig message="Loading…" />
      )}
    </BottomNavLayout>
  );
}
