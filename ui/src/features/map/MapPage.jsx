import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { CloudOff, Navigation } from "lucide-react";
import { fetchMemories } from "@/features/journal/journalSlice";
import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import { memoryMarkers } from "@/features/map/memoryMarkers";
import { MapControls } from "@/features/map/MapControls";
import { MapInfoContent } from "@/features/map/MapInfoContent";
import { filterMarkers, viewFor } from "@/features/map/mapFilters";
import { colorFor, directionsUrl, glyphSrcFor, iconFor, NEW_PLACE_GLYPH_SRC } from "@/features/map/mapStyle";
import { isArea } from "@/features/map/placeActions";
import { PointOfInterestForm } from "@/features/pointsOfInterest/PointOfInterestForm";
import { POI_CATEGORY_LABEL } from "@/features/pointsOfInterest/pointsOfInterest";
import { ActivityForm } from "@/features/timeline/ActivityForm";
import { stayCoverage } from "@/features/timeline/coverageView";
import { runEdit } from "@/features/timeline/runEdit";
import { StayForm } from "@/features/timeline/StayForm";
import {
  createItem,
  createPointOfInterest,
  createStay,
  createTravel,
  deletePointOfInterest,
  fetchTrip,
  replacePointOfInterest,
  selectIsViewer,
  selectReadOnly,
} from "@/features/timeline/timelineSlice";
import { TravelForm } from "@/features/timeline/TravelForm";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { getClientConfig } from "@/shared/services/clientConfig";
import { loadGoogleMapsLibrary } from "@/shared/services/googleMapsLoader";
import { permissionState, watchPosition } from "@/shared/services/geolocation";
import { notify } from "@/shared/notificationSlice";
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
  // By day; points of interest (on no day) last.
  const days = [...markers].sort((a, b) => (a.day === null) - (b.day === null) || (a.day ?? "").localeCompare(b.day ?? ""));
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
                    {m.day ? formatDayHeading(m.day) : `Point of interest · ${POI_CATEGORY_LABEL[m.category] ?? "Other"}`}
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
  poi: { kind: "poi" },
};

/**
 * The full-screen map: one marker per located stay, travel endpoint and
 * activity, plus — after a Google search — one temporary "search result"
 * marker for a place not on the trip, whose info window offers to add it.
 */
/**
 * Point the map at a view from viewFor: fit the places (with some room
 * round the edge for the pins), or centre on the only one. Nothing to show
 * leaves the view where it is.
 */
function showView(map, view, { singleZoom = 14, padding = 48 } = {}) {
  if (!view) return;
  if (view.kind === "point") {
    map.panTo(view.point);
    map.setZoom(singleZoom);
    return;
  }
  const bounds = new window.google.maps.LatLngBounds();
  view.points.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, padding);
}

function TripMap({ trip }) {
  const dispatch = useDispatch();
  const online = useSelector((s) => s.network?.online ?? true);
  const readOnly = useSelector(selectReadOnly);
  const isViewer = useSelector(selectIsViewer);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  // The filters the map was last pointed at ("only|date"); null until it loads.
  const viewKeyRef = useRef(null);
  const infoWindowRef = useRef(null);
  const entriesRef = useRef([]); // [{ element, data }]
  const resultMarkerRef = useRef(null); // the search result's AdvancedMarkerElement
  const libsRef = useRef(null); // { AdvancedMarkerElement, PinElement }, set once the map is ready
  // The InfoWindow's content node; React renders into it through a portal.
  const [infoNode] = useState(() => document.createElement("div"));
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  // The "what" filter: null (the trip's places), "stays" or "memories".
  const [only, setOnly] = useState(null);
  const [date, setDate] = useState("");
  // null | { kind: "trip", marker } | { kind: "place", place, types }
  const [info, setInfo] = useState(null);
  // The picked Google place on the map: null | { place, types }
  const [result, setResult] = useState(null);
  // null | { kind: "activity" | "stay" | "travel", prefill, date }
  //      | { kind: "poi", prefill } (new) | { kind: "poi", poi } (edit)
  const [form, setForm] = useState(null);
  // The point of interest waiting for "Delete?" to be confirmed, or null.
  const [deletingPoi, setDeletingPoi] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // The trip's places, plus journal memories that carry a location.
  const journal = useSelector((s) => (s.journal?.tripId === trip.id ? s.journal.items : null));
  const markers = useMemo(
    () => [...buildMapMarkers(trip), ...memoryMarkers(journal ?? [])],
    [trip, journal]
  );
  // The blue "you are here" dot: { marker, circle, stop, last } once watching.
  const meRef = useRef(null);
  const [locating, setLocating] = useState(false);
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
        const { Circle } = await loadGoogleMapsLibrary("maps");
        if (!live || !containerRef.current) return;

        // The initial view: the trip's destinations (viewFor with no
        // filters), not travel's endpoints, which are often a continent away.
        const map = new Map(containerRef.current, { mapId: config.googleMapsMapId, center: { lat: 0, lng: 0 }, zoom: 2 });
        mapRef.current = map;
        viewKeyRef.current = null;
        const infoWindow = new InfoWindow();
        infoWindow.addListener("closeclick", () => setInfo(null));
        infoWindowRef.current = infoWindow;
        showView(map, viewFor(markers), { singleZoom: 12, padding: 0 });

        libsRef.current = { AdvancedMarkerElement, PinElement, Circle };
        if (live) setReady(true);
        // Already allowed? Show where you are straight away. Otherwise the
        // "locate me" button asks, so opening the map never pops a prompt.
        if (live && (await permissionState()) === "granted") startWatching({ center: false });
      } catch {
        if (live) setError("Couldn’t load Google Maps.");
      }
    })();

    return () => {
      live = false;
      entriesRef.current.forEach(({ element }) => (element.map = null));
      entriesRef.current = [];
      stopWatching();
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
    entriesRef.current = filterMarkers(markers, { only, date: date || null }).map((marker) => {
      const color = colorFor(marker);
      const pin = new PinElement({
        background: color,
        borderColor: color,
        glyphColor: "#fff",
        glyphSrc: glyphSrcFor(marker),
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
  }, [ready, markers, only, date]);

  // Changing a filter (a day, Stays, Journal) moves the map to what's left.
  // Only a change of filter does: the first view is set when the map loads,
  // and a trip reload or panning by hand never re-fits.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const key = `${only ?? ""}|${date}`;
    if (viewKeyRef.current === null) {
      viewKeyRef.current = key; // the view the map opened with
      return;
    }
    if (viewKeyRef.current === key) return;
    viewKeyRef.current = key;
    showView(mapRef.current, viewFor(markers, { only, date: date || null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markers only matter at the moment a filter changes
  }, [ready, only, date]);

  const visibleMarkers = useMemo(
    () => filterMarkers(markers, { only, date: date || null }),
    [markers, only, date]
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

  /** Show the phone's position as a blue dot with its accuracy circle. */
  function showMe(position) {
    const map = mapRef.current;
    const libs = libsRef.current;
    if (!map || !libs || !meRef.current) return;
    const center = { lat: position.lat, lng: position.lng };
    const me = meRef.current;
    if (!me.marker) {
      const dot = document.createElement("div");
      dot.className = "pripri-me-dot";
      dot.style.cssText =
        "width:16px;height:16px;border-radius:50%;background:#1a73e8;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)";
      me.marker = new libs.AdvancedMarkerElement({ map, position: center, content: dot, title: "You are here", zIndex: 2000 });
      // Honest about uncertainty: the circle is the phone's own accuracy radius.
      me.circle = new libs.Circle({
        map,
        center,
        radius: position.accuracy ?? 0,
        fillColor: "#1a73e8",
        fillOpacity: 0.12,
        strokeColor: "#1a73e8",
        strokeOpacity: 0.35,
        strokeWeight: 1,
        clickable: false,
      });
    } else {
      me.marker.position = center;
      me.circle.setCenter(center);
      me.circle.setRadius(position.accuracy ?? 0);
    }
    const firstFix = !me.last;
    me.last = center;
    if (firstFix && me.centerOnFirst) focus(center);
  }

  function startWatching({ center }) {
    if (meRef.current) return;
    meRef.current = { centerOnFirst: center };
    setLocating(true);
    meRef.current.stop = watchPosition(
      (position) => {
        setLocating(false);
        showMe(position);
      },
      () => {
        setLocating(false);
        stopWatching();
        dispatch(notify({ type: "error", message: "Your location isn’t available. Check it’s allowed for this site." }));
      }
    );
  }

  function stopWatching() {
    const me = meRef.current;
    if (!me) return;
    me.stop?.();
    if (me.marker) me.marker.map = null;
    me.circle?.setMap(null);
    meRef.current = null;
  }

  /** "Locate me": start following the phone (asks the first time), or re-center on it. */
  function locateMe() {
    if (meRef.current?.last) focus(meRef.current.last);
    else if (meRef.current) meRef.current.centerOnFirst = true;
    else startWatching({ center: true });
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
      glyphSrc: NEW_PLACE_GLYPH_SRC,
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
    if (kind === "poi") {
      setForm({ kind, prefill: { place: info.place, types: info.types } });
      return;
    }
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

  /** The point of interest a marker stands for (the live record, for its version). */
  const poiFor = (marker) => (trip.pointsOfInterest ?? []).find((p) => p.id === marker.entryId) ?? null;

  function closeInfo() {
    infoWindowRef.current?.close();
    setInfo(null);
  }

  function editPoi(marker) {
    const poi = poiFor(marker);
    if (poi) setForm({ kind: "poi", poi });
  }

  async function confirmDeletePoi() {
    setDeleteBusy(true);
    const outcome = await runEdit(
      dispatch,
      deletePointOfInterest({ tripId: trip.id, poiId: deletingPoi.id, version: deletingPoi.version })
    );
    setDeleteBusy(false);
    setDeletingPoi(null);
    if (outcome.ok || outcome.reloaded) closeInfo();
  }

  async function save(payload) {
    const tripId = trip.id;
    if (form.kind === "poi") {
      const thunk = form.poi
        ? replacePointOfInterest({ tripId, poiId: form.poi.id, poi: payload, version: form.poi.version })
        : createPointOfInterest({ tripId, poi: payload });
      const outcome = await runEdit(dispatch, thunk);
      if (outcome.ok) {
        // New: it's a point of interest's own pin now. Edited: its info
        // window would show the old details, so it closes.
        if (form.poi) closeInfo();
        else clearResult();
      }
      return outcome;
    }
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
          only={only}
          onOnlyChange={setOnly}
          onLocate={locateMe}
          locating={locating}
          date={date}
          onDateChange={setDate}
        />
      )}
      {info &&
        createPortal(
          <MapInfoContent
            info={info}
            tripId={trip.id}
            onAction={startAdd}
            onEditPoi={editPoi}
            onDeletePoi={(marker) => setDeletingPoi(poiFor(marker))}
            readOnly={readOnly}
            canAdd={!isViewer}
          />,
          infoNode
        )}

      {form?.kind === "activity" && <ActivityForm {...formProps} item={null} />}
      {form?.kind === "stay" && <StayForm {...formProps} stay={null} />}
      {form?.kind === "travel" && <TravelForm {...formProps} travel={null} />}
      {form?.kind === "poi" && (
        <PointOfInterestForm
          open
          onClose={() => setForm(null)}
          trip={trip}
          poi={form.poi ?? null}
          prefill={form.prefill}
          onSave={save}
        />
      )}
      <Dialog
        open={deletingPoi !== null}
        onClose={() => !deleteBusy && setDeletingPoi(null)}
        title="Delete point of interest?"
        description={deletingPoi ? `${deletingPoi.name} will be removed from the map for everyone on the trip.` : undefined}
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeletingPoi(null)} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDeletePoi} disabled={deleteBusy}>
            {deleteBusy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
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
    dispatch(fetchMemories(tripId)); // memories with a location become pins
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
