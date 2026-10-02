import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsLibrary } from "@/shared/services/googleMapsLoader";
import { cn } from "@/shared/utils/cn";

/**
 * A small, non-interactive map centered on one point — just enough to
 * visually confirm "is this the right spot", in the place picker and in a
 * location's expanded details. Renders nothing if there's no key, Maps
 * fails to load, or there are no coordinates to show.
 */
export function MiniMap({ lat, lng, className }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (lat == null || lng == null) return undefined;
    let live = true;
    let marker = null;
    let map = null;

    (async () => {
      try {
        const { Map } = await loadGoogleMapsLibrary("maps");
        const { Marker } = await loadGoogleMapsLibrary("marker");
        if (!live || !ref.current) return;
        map = new Map(ref.current, {
          center: { lat, lng },
          zoom: 15,
          disableDefaultUI: true,
          gestureHandling: "none",
          keyboardShortcuts: false,
          clickableIcons: false,
        });
        marker = new Marker({ map, position: { lat, lng } });
      } catch {
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
      marker?.setMap(null);
    };
  }, [lat, lng]);

  if (lat == null || lng == null || failed) return null;

  return <div ref={ref} className={cn("overflow-hidden rounded-md bg-muted", className)} aria-hidden="true" />;
}
