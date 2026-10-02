import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { buildMapMarkers } from "@/features/map/buildMapMarkers";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { BottomNavLayout } from "@/shared/components/BottomNavLayout";
import { Card } from "@/shared/components/ui/card";
import { getClientConfig } from "@/shared/services/clientConfig";
import { loadGoogleMapsLibrary } from "@/shared/services/googleMapsLoader";
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
  return `
    <div style="max-width:220px;">
      ${photo}
      <div style="font-weight:600;margin-bottom:2px;">${escapeHtml(marker.title)}</div>
      <div style="font-size:12px;color:#777;margin-bottom:6px;">${formatDayHeading(marker.day)}</div>
      <a href="${dayUrl}" style="display:block;font-size:13px;margin-bottom:2px;color:#2a78d6;">View day</a>
      <a href="${directions}" target="_blank" rel="noopener noreferrer" style="display:block;font-size:13px;color:#2a78d6;">Directions</a>
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

/** The full-screen map: one marker per located stay, travel endpoint and activity. */
function TripMap({ trip }) {
  const ref = useRef(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const markers = useMemo(() => buildMapMarkers(trip), [trip]);

  useEffect(() => {
    getClientConfig()
      .then(setConfig)
      .catch(() => setError("Couldn’t load map configuration."));
  }, []);

  useEffect(() => {
    if (!config?.googleMapsApiKey || !config?.googleMapsMapId || !ref.current) return undefined;
    let live = true;
    let map = null;
    const createdMarkers = [];
    let infoWindow = null;

    (async () => {
      try {
        const { Map, InfoWindow } = await loadGoogleMapsLibrary("maps");
        const { AdvancedMarkerElement, PinElement } = await loadGoogleMapsLibrary("marker");
        if (!live || !ref.current) return;

        map = new Map(ref.current, {
          mapId: config.googleMapsMapId,
          center: markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : { lat: 0, lng: 0 },
          zoom: markers.length ? 12 : 2,
        });
        infoWindow = new InfoWindow();

        const bounds = new window.google.maps.LatLngBounds();
        markers.forEach((marker) => {
          const color = colorFor(marker);
          const pin = new PinElement({
            background: color,
            borderColor: color,
            glyphColor: "#fff",
            glyph: glyphFor(marker),
          });
          const advanced = new AdvancedMarkerElement({
            map,
            position: { lat: marker.lat, lng: marker.lng },
            title: marker.title,
            content: pin.element,
          });
          advanced.addListener("click", () => {
            infoWindow.setContent(infoWindowHtml(marker, trip.id));
            infoWindow.open({ map, anchor: advanced });
          });
          createdMarkers.push(advanced);
          bounds.extend({ lat: marker.lat, lng: marker.lng });
        });
        if (markers.length > 1) map.fitBounds(bounds);
      } catch {
        if (live) setError("Couldn’t load Google Maps.");
      }
    })();

    return () => {
      live = false;
      createdMarkers.forEach((m) => (m.map = null));
      infoWindow?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markers derive from trip, stable per trip load
  }, [config, trip.id]);

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

  return <div ref={ref} className="h-full w-full" />;
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
