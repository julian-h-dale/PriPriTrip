import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Box, CircularProgress } from '@mui/material';
import LoginPage from './pages/LoginPage';
import { selectIsAuthenticated } from './store/authSlice';

// Route-level code splitting (review 2C-5). LoginPage stays eager so the
// first paint for signed-out users needs no extra chunk.
const HomePage = lazy(() => import('./pages/HomePage'));
const DocumentImporterPage = lazy(() => import('./pages/DocumentImporterPage'));
const DocumentImportReviewPage = lazy(() => import('./pages/DocumentImportReviewPage'));
const ImportTripPage = lazy(() => import('./pages/ImportTripPage'));
const ImportSummaryPage = lazy(() => import('./pages/ImportSummaryPage'));
const NewTripPage = lazy(() => import('./pages/NewTripPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const StayDetailsPage = lazy(() => import('./pages/StayDetailsPage'));
const TravelDetailsPage = lazy(() => import('./pages/TravelDetailsPage'));
const TripInspectionPage = lazy(() => import('./pages/TripInspectionPage'));
const TripWorkflowPage = lazy(() => import('./pages/TripWorkflowPage'));
const TripsPage = lazy(() => import('./pages/TripsPage'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function ProtectedRoute({ children }) {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function RouteFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 10 }}>
      <CircularProgress />
    </Box>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<RouteFallback />}>
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
          path="/trip/:tripId/document-import"
          element={
            <ProtectedRoute>
              <DocumentImporterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trip/:tripId/document-import/review"
          element={
            <ProtectedRoute>
              <DocumentImportReviewPage />
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
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
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
        <Route
          path="/trip/:tripId/workflow"
          element={
            <ProtectedRoute>
              <TripWorkflowPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
