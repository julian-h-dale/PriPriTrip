import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { Link, matchPath, useLocation } from "react-router-dom";
import { CloudSun, Coins, KeyRound, List, LogOut, Shield, UserPlus, X } from "lucide-react";
import { InviteUserDialog } from "@/features/admin/InviteUserDialog";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { signOut } from "@/features/auth/authSlice";
import { selectPendingMemories, selectWaitingPhotos } from "@/features/journal/journalSlice";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { InstallAppButton } from "@/shared/pwa/InstallAppButton";

const ITEM =
  "flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** What signing out would lose: memories not yet synced, photos not yet uploaded. */
function signOutWarning(memories, photos) {
  const parts = [];
  if (memories > 0) parts.push(`${memories} ${memories === 1 ? "memory hasn’t" : "memories haven’t"} synced`);
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? "photo hasn’t" : "photos haven’t"} been uploaded`);
  const lost = `${parts.join(" and ")} yet. Signing out deletes them from this phone.`;
  return photos > 0
    ? `${lost} Photos taken in the app aren’t saved anywhere else. Upload them from the Journal first.`
    : `${lost} Get online first to keep them.`;
}

/**
 * The app's slide-in menu (☰): everything needed rarely — all trips, install,
 * admin, sign out — so the trip itself gets the screen. Hand-rolled in the
 * dialog's shadcn shape: Escape or the backdrop closes it, and focus moves in
 * on open and back to the opener on close.
 */
/** The trip on screen, if any: the drawer's Trip tools need one. */
function useOpenTripId() {
  const { pathname } = useLocation();
  return matchPath({ path: "/trips/:tripId", end: false }, pathname)?.params.tripId ?? null;
}

export function NavDrawer({ open, onClose }) {
  const dispatch = useDispatch();
  const tripId = useOpenTripId();
  const { pathname } = useLocation();
  const [inviting, setInviting] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const user = useSelector((s) => s.auth.user);
  const unsynced = useSelector(selectPendingMemories);
  const { count: photos } = useSelector(selectWaitingPhotos);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  function handleSignOut() {
    // Signing out forgets memories and photos still waiting in the outbox: say so first.
    if (unsynced > 0 || photos > 0) setConfirmSignOut(true);
    else dispatch(signOut());
  }
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
        {tripId && (
          <section aria-label="Trip tools" className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            <h2 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Trip tools</h2>
            <Link to={`/trips/${tripId}/weather`} onClick={onClose} className={ITEM}>
              <CloudSun className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Weather
            </Link>
            <Link to={`/trips/${tripId}/currency`} onClick={onClose} className={ITEM}>
              <Coins className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Currency
            </Link>
          </section>
        )}
        <InstallAppButton variant="ghost" className="h-auto w-full justify-start gap-3 px-3 py-3 font-normal" />
        {/* Only rendered for admins; the server still enforces access. */}
        {user?.is_superuser && pathname === "/trips" && (
          <button type="button" onClick={() => setInviting(true)} className={ITEM}>
            <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Invite someone
          </button>
        )}
        {user?.is_superuser && (
          <Link to="/admin" onClick={onClose} className={ITEM}>
            <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Admin
          </Link>
        )}
        <div className="mt-auto border-t border-border pt-2">
          <button type="button" onClick={() => setChangingPassword(true)} className={ITEM}>
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Change password
          </button>
          <button type="button" onClick={handleSignOut} className={ITEM}>
            <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </nav>
      <InviteUserDialog open={inviting} onClose={() => setInviting(false)} />
      <Dialog open={changingPassword} onClose={() => setChangingPassword(false)} title="Change password">
        {changingPassword && (
          <ChangePasswordForm onDone={() => setChangingPassword(false)} onCancel={() => setChangingPassword(false)} />
        )}
      </Dialog>
      <Dialog
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Sign out anyway?"
        description={signOutWarning(unsynced, photos)}
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmSignOut(false)}>
            Stay signed in
          </Button>
          <Button variant="destructive" onClick={() => dispatch(signOut())}>
            Sign out
          </Button>
        </DialogFooter>
      </Dialog>
    </div>,
    document.body
  );
}
