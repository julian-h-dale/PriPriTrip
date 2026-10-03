import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { List, LogOut, Shield, X } from "lucide-react";
import { signOut } from "@/features/auth/authSlice";
import { InstallAppButton } from "@/shared/pwa/InstallAppButton";

const ITEM =
  "flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The app's slide-in menu (☰): everything needed rarely — all trips, install,
 * admin, sign out — so the trip itself gets the screen. Hand-rolled in the
 * dialog's shadcn shape: Escape or the backdrop closes it, and focus moves in
 * on open and back to the opener on close.
 */
export function NavDrawer({ open, onClose }) {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    panelRef.current?.focus();
    function onKeyDown(e) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" aria-hidden="true" onClick={onClose} />
      <nav
        ref={panelRef}
        aria-label="Menu"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-1 border-r border-border bg-card p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] focus:outline-none"
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-3">
          <div className="min-w-0">
            <p className="font-semibold">PriPriTrip</p>
            {user?.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-sm p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <Link to="/trips" onClick={onClose} className={ITEM}>
          <List className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          All trips
        </Link>
        <InstallAppButton variant="ghost" className="h-auto w-full justify-start gap-3 px-3 py-3 font-normal" />
        {/* Only rendered for admins; the server still enforces access. */}
        {user?.is_superuser && (
          <Link to="/admin" onClick={onClose} className={ITEM}>
            <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Admin
          </Link>
        )}
        <div className="mt-auto border-t border-border pt-2">
          <button type="button" onClick={() => dispatch(signOut())} className={ITEM}>
            <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </nav>
    </div>,
    document.body
  );
}
