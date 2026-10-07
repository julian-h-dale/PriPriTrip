import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useParams } from "react-router-dom";
import { fetchTrip } from "@/features/timeline/timelineSlice";

/**
 * A trip page a viewer doesn't get (Run stage 17): Today and the Trip tools.
 * A viewer goes to the trip's timeline instead. It waits until the trip (or
 * the phone's saved copy) says who you are on it, so a viewer's page never
 * starts asking the server for things it refuses viewers (weather, packing).
 * If the trip can't be read at all, the page itself says so.
 *
 * A convenience, like AdminRoute: the server is what refuses (403).
 */
export function NotForViewers({ children }) {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);
  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  useEffect(() => {
    if (!current) dispatch(fetchTrip(tripId));
  }, [current, dispatch, tripId]);

  if (current?.role === "viewer") return <Navigate to={`/trips/${tripId}`} replace />;
  if (current || status === "notFound" || status === "failed") return children;
  return <div aria-label="Loading" className="h-dvh bg-background" />;
}
