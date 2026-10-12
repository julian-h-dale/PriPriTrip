import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate } from "react-router-dom";
import { selectGuestTripId } from "@/features/auth/authSlice";
import { fetchTrips } from "@/features/trips/tripsSlice";
import { pickLandingTrip, tripHomePath } from "@/shared/utils/tripDates";

/**
 * `/`: open straight onto the trip that matters now — the active one, else
 * the next upcoming one — on its Today tab (a viewer, who has no Today tab,
 * on its timeline). With neither, the trips list.
 * Works offline from the saved trips list.
 */
export function LandingPage() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.trips.items);
  // A link guest (Run stage 31) has one trip: always that one.
  const guestTripId = useSelector(selectGuestTripId);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let live = true;
    // Settled either way: the server answered, or it didn't and the offline
    // copy (if any) is already in the list.
    dispatch(fetchTrips()).finally(() => live && setSettled(true));
    return () => {
      live = false;
    };
  }, [dispatch]);

  if (guestTripId) return <Navigate to={`/trips/${guestTripId}`} replace />;
  if (!settled) return <div aria-label="Loading" className="h-dvh bg-background" />;
  const trip = pickLandingTrip(items);
  if (!trip) return <Navigate to="/trips" replace />;
  return <Navigate to={tripHomePath(trip)} replace />;
}
