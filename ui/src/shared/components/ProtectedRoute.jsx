import { useSelector } from "react-redux";
import { Navigate } from "react-router-dom";
import { ForcedPasswordChange } from "@/features/auth/ForcedPasswordChange";
import { selectMustChangePassword } from "@/features/auth/authSlice";

/**
 * Gates authenticated areas: no token goes to /login, and an account still
 * holding a temporary password sees only "Choose a new password".
 */
export function ProtectedRoute({ children }) {
  const token = useSelector((s) => s.auth.token);
  const mustChange = useSelector(selectMustChangePassword);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (mustChange) {
    return <ForcedPasswordChange />;
  }
  return children;
}
