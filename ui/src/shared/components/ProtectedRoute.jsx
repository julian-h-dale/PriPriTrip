import { useSelector } from "react-redux";
import { Navigate } from "react-router-dom";

/** Gates authenticated areas; redirects to /login when no token is present. */
export function ProtectedRoute({ children }) {
  const token = useSelector((s) => s.auth.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
