import { useSelector } from "react-redux";
import { Navigate } from "react-router-dom";
import { ForcedPasswordChange } from "@/features/auth/ForcedPasswordChange";

/**
 * Gates admin-only areas. Redirects to /login when unauthenticated and to /
 * when the signed-in user is not a superuser. This is a convenience gate — the
 * real boundary is the server's `current_superuser` (403), which the hidden
 * nav button and this redirect merely mirror.
 */
export function AdminRoute({ children }) {
  const token = useSelector((s) => s.auth.token);
  const user = useSelector((s) => s.auth.user);

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  // Wait for the user to hydrate before deciding (App dispatches fetchMe).
  if (!user) {
    return null;
  }
  if (user.must_change_password) {
    return <ForcedPasswordChange />;
  }
  if (!user.is_superuser) {
    return <Navigate to="/" replace />;
  }
  return children;
}
