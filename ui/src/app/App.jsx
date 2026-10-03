import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchMe } from "@/features/auth/authSlice";
import { LoginPage } from "@/features/auth/LoginPage";
import { LandingPage } from "@/features/trips/LandingPage";
import { TripsPage } from "@/features/trips/TripsPage";
import { MapPage } from "@/features/map/MapPage";
import { TodayPage } from "@/features/today/TodayPage";
import { JournalPage } from "@/features/journal/JournalPage";
import { DayDetailPage } from "@/features/timeline/DayDetailPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { AdminUsersPage } from "@/features/admin/AdminUsersPage";
import { ProtectedRoute } from "@/shared/components/ProtectedRoute";
import { AdminRoute } from "@/shared/components/AdminRoute";
import { Toaster } from "@/shared/components/Toaster";
import { PwaUpdate } from "@/shared/pwa/PwaUpdate";
import { useOutboxSync } from "@/shared/pwa/useOutboxSync";

export function App() {
  const dispatch = useDispatch();
  const token = useSelector((s) => s.auth.token);
  // Memories written offline go out whenever there's a chance.
  useOutboxSync();

  // Hydrate the user on load if a token survived a refresh.
  useEffect(() => {
    if (token) {
      dispatch(fetchMe());
    }
  }, [dispatch, token]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <LandingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips"
          element={
            <ProtectedRoute>
              <TripsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips/:tripId"
          element={
            <ProtectedRoute>
              <TripTimelinePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips/:tripId/today"
          element={
            <ProtectedRoute>
              <TodayPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips/:tripId/journal"
          element={
            <ProtectedRoute>
              <JournalPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips/:tripId/days/:date"
          element={
            <ProtectedRoute>
              <DayDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips/:tripId/map"
          element={
            <ProtectedRoute>
              <MapPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminUsersPage />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
      <PwaUpdate />
    </>
  );
}
