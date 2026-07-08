import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import HomePage from './pages/HomePage';
import ImportTripPage from './pages/ImportTripPage';
import ImportSummaryPage from './pages/ImportSummaryPage';
import LoginPage from './pages/LoginPage';
import NewTripPage from './pages/NewTripPage';
import RegisterPage from './pages/RegisterPage';
import StayDetailsPage from './pages/StayDetailsPage';
import TravelDetailsPage from './pages/TravelDetailsPage';
import TripInspectionPage from './pages/TripInspectionPage';
import TripsPage from './pages/TripsPage';
import { selectIsAuthenticated } from './store/authSlice';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function ProtectedRoute({ children }) {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <TripsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/trip/:tripId"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/trip/:tripId/stays"
        element={
          <ProtectedRoute>
            <StayDetailsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/trip/:tripId/travels"
        element={
          <ProtectedRoute>
            <TravelDetailsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/new-trip"
        element={
          <ProtectedRoute>
            <NewTripPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/import-trip"
        element={
          <ProtectedRoute>
            <ImportTripPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/import-summary/:tripId"
        element={
          <ProtectedRoute>
            <ImportSummaryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/trip-inspection/:tripId"
        element={
          <ProtectedRoute>
            <TripInspectionPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
