import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchMe } from "@/features/auth/authSlice";
import { LoginPage } from "@/features/auth/LoginPage";
import { TripsPage } from "@/features/trips/TripsPage";
import { TripTimelinePage } from "@/features/timeline/TripTimelinePage";
import { AdminUsersPage } from "@/features/admin/AdminUsersPage";
import { ProtectedRoute } from "@/shared/components/ProtectedRoute";
import { AdminRoute } from "@/shared/components/AdminRoute";
import { Toaster } from "@/shared/components/Toaster";

export function App() {
  const dispatch = useDispatch();
  const token = useSelector((s) => s.auth.token);

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
    </>
  );
}
