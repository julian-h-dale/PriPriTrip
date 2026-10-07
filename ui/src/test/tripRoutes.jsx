import { Route } from "react-router-dom";
import { EntryPage } from "@/features/entry/EntryPage";
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";

/**
 * The trip's own pages, as App.jsx routes them, for tests that go from a
 * timeline row to its entry's page and back: put them inside <Routes>.
 */
export function tripRoutes() {
  return [
    <Route key="trip" path="/trips/:tripId" element={<TripTimelinePage />} />,
    <Route key="day" path="/trips/:tripId/days/:date" element={<DayDetailPage />} />,
    <Route key="activity" path="/trips/:tripId/activities/:id" element={<EntryPage kind="activity" />} />,
    <Route key="stay" path="/trips/:tripId/stays/:id" element={<EntryPage kind="stay" />} />,
    <Route key="travel" path="/trips/:tripId/travel/:id" element={<EntryPage kind="travel" />} />,
  ];
}
