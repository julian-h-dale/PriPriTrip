import { fetchMemories, syncOutbox } from "@/features/journal/journalSlice";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { fetchTrips } from "@/features/trips/tripsSlice";
import { flush } from "@/shared/analytics/umami";
import { refreshingChanged } from "@/shared/networkSlice";

/**
 * "Refresh once" (Run stage 20, Phase 81): with "Use saved copies only" on,
 * one round of the network and back. The trips list and the open trip (and
 * its journal) reload and are saved on the phone; memories waiting in the
 * outbox go, and so does the analytics queue. Photos don't: they wait for
 * their own Upload button. Then it's saved copies only again.
 */
export function refreshOnce() {
  return async (dispatch, getState) => {
    const { network, timeline } = getState();
    if (!network?.savedOnly || network.refreshing || network.online === false) return;
    dispatch(refreshingChanged(true));
    try {
      const tripId = timeline?.tripId;
      await Promise.allSettled([
        dispatch(fetchTrips()),
        tripId ? dispatch(fetchTrip(tripId)) : null,
        tripId ? dispatch(fetchMemories(tripId)) : null,
      ]);
      await dispatch(syncOutbox()); // memories only: photos need their Upload button
      await flush({ force: true });
    } finally {
      dispatch(refreshingChanged(false));
    }
  };
}
