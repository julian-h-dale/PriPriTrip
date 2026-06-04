import { Navigate, Route, Routes } from 'react-router-dom';
import { useSelector } from 'react-redux';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NewTripPage from './pages/NewTripPage';
import TripsPage from './pages/TripsPage';
import { selectIsAuthenticated } from './store/authSlice';

function ProtectedRoute({ children }) {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
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
        path="/trip/:tripId"
        element={
          <ProtectedRoute>
            <HomePage />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
