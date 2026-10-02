import { useEffect, useState } from "react";
import { apiClient } from "@/shared/services/apiClient";

const cache = new Map();

/** The IANA zone at a coordinate, from the same lookup the server uses (GET /timezone). */
export function zoneAt(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      apiClient
        .get("/timezone", { params: { lat, lng }, silent: true })
        .then(({ data }) => data.timezone ?? null)
        .catch(() => {
          cache.delete(key);
          return null;
        })
    );
  }
  return cache.get(key);
}

/** The zone a place puts its times on, or null when it has no coordinates (yet). */
export function usePlaceZone(place) {
  const lat = place?.lat;
  const lng = place?.lng;
  const [zone, setZone] = useState(null);
  useEffect(() => {
    let live = true;
    if (lat == null || lng == null) {
      setZone(null);
      return undefined;
    }
    zoneAt(lat, lng).then((z) => live && setZone(z));
    return () => {
      live = false;
    };
  }, [lat, lng]);
  return zone;
}
