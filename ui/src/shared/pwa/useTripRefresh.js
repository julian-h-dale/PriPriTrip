import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchTrip } from "@/features/timeline/timelineSlice";

/**
 * Reload the open trip whenever the app returns to the foreground (online
 * only), so someone else's changes show up and a stale edit is less likely.
 * The trip stays on screen while it reloads.
 */
export function useTripRefresh() {
  const dispatch = useDispatch();
  const tripId = useSelector((s) => s.timeline?.tripId);
  const online = useSelector((s) => s.network?.online ?? true);

  useEffect(() => {
    if (!tripId || !online) return undefined;
    function onVisible() {
      if (document.visibilityState === "visible") dispatch(fetchTrip(tripId));
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [dispatch, tripId, online]);
}
