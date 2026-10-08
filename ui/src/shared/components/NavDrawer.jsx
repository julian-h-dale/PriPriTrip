import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { Link, matchPath, useLocation } from "react-router-dom";
import { Clock, CloudOff, CloudSun, Coins, FileText, KeyRound, List, LogOut, Luggage, Shield, Sun, UserPlus, X } from "lucide-react";
import { InviteUserDialog } from "@/features/admin/InviteUserDialog";
import { ShareTripDialog } from "@/features/sharing/ShareTripDialog";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { signOut } from "@/features/auth/authSlice";
import { selectPendingMemories, selectWaitingPhotos } from "@/features/journal/journalSlice";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { InstallAppButton } from "@/shared/pwa/InstallAppButton";
import { useTrack } from "@/shared/analytics/useAnalytics";
import { saveTripsForOffline } from "@/features/trips/tripsSlice";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/utils/cn";
import { selectSavedOnly, setSavedOnly } from "@/shared/networkSlice";
import { setTheme, useTheme } from "@/shared/theme";
import { TEXT_SIZES, setTextSize, useTextSize } from "@/shared/textSize";

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

/**
 * "Use saved copies only" (Run stage 20): keeps the app offline on purpose,
 * to save mobile data. For everyone (it's about this phone's data plan,
 * not editing), remembered until turned off. Turning it on saves the trips
 * that haven't ended first, while there's a connection.
 */
function SavedOnlySwitch() {
  const dispatch = useDispatch();
  const on = useSelector(selectSavedOnly);
  const saving = useSelector((s) => Boolean(s.network?.saving));
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor="saved-only" className="text-sm">
          Use saved copies only
        </label>
        <p id="saved-only-hint" className="text-xs text-muted-foreground">
          {saving
            ? "Saving your trips to this phone…"
            : on
              ? "Nothing loads over the network. Memories and photos wait on the phone."
              : "Saves mobile data: nothing loads over the network."}
        </p>
      </div>
      <Switch
        id="saved-only"
        checked={on}
        disabled={saving}
        aria-describedby="saved-only-hint"
        onChange={(next) => dispatch(setSavedOnly(next, saveTripsForOffline))}
      />
    </div>
  );
}

/**
 * Light mode (Run stage 22), on the All trips screen's drawer: for reading
 * outdoors in bright sun. A choice for this phone; dark is the default.
 */
function LightModeSwitch() {
  const theme = useTheme();
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <Sun className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor="light-mode" className="text-sm">
          Light mode
        </label>
        <p id="light-mode-hint" className="text-xs text-muted-foreground">
          Easier to read in bright sun.
        </p>
      </div>
      <Switch
        id="light-mode"
        checked={theme === "light"}
        aria-describedby="light-mode-hint"
        onChange={(on) => setTheme(on ? "light" : "dark")}
      />
    </div>
  );
}

/**
 * Text size (Run stage 22), beside Light mode: Normal, Large or Larger.
 * A choice for this phone.
 */
function TextSizeChoice() {
  const current = useTextSize();
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <span id="text-size-label" className="text-sm">
        Text size
      </span>
      <div role="radiogroup" aria-labelledby="text-size-label" className="grid grid-cols-3 rounded-md border border-border bg-background p-1">
        {TEXT_SIZES.map((size, i) => (
          <button
            key={size.key}
            type="button"
            role="radio"
            aria-checked={current === size.key}
            onClick={() => setTextSize(size.key)}
            className={cn(
              "min-h-9 rounded-sm px-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ["text-xs", "text-sm", "text-base"][i],
              current === size.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {size.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NavDrawer({ open, onClose }) {
  const dispatch = useDispatch();
  const tripId = useOpenTripId();
  const { pathname } = useLocation();
  const [inviting, setInviting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const user = useSelector((s) => s.auth.user);
  // Documents are for the owner and editors (the server refuses viewers).
  const trip = useSelector((s) => (s.timeline?.trip?.id === tripId ? s.timeline.trip : null));
  const canEditTrip = Boolean(trip) && trip.role !== "viewer";
  // Only the owner shares (the server enforces it too).
  const isOwner = trip?.role === "owner";
  const isViewer = trip?.role === "viewer";
  const unsynced = useSelector(selectPendingMemories);
  const { count: photos } = useSelector(selectWaitingPhotos);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const track = useTrack();
  // A Trip tool opened from here (its page view says it was opened at all).
  const openTool = (tool) => () => {
    track("tool-open", { tool });
    onClose();
  };

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
        {/* A viewer follows along: no Trip tools at all (Run stage 17). */}
        {tripId && !isViewer && (
          <section aria-label="Trip tools" className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            <h2 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Trip tools</h2>
            <Link to={`/trips/${tripId}/currency`} onClick={openTool("currency")} className={ITEM}>
              <Coins className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Currency
            </Link>
            <Link to={`/trips/${tripId}/weather`} onClick={openTool("weather")} className={ITEM}>
              <CloudSun className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Weather
            </Link>
            <Link to={`/trips/${tripId}/time`} onClick={openTool("timezones")} className={ITEM}>
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Time zones
            </Link>
            <Link to={`/trips/${tripId}/packing`} onClick={openTool("packing")} className={ITEM}>
              <Luggage className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Packing
            </Link>
            {canEditTrip && (
              <Link to={`/trips/${tripId}/documents`} onClick={openTool("documents")} className={ITEM}>
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Documents
              </Link>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  track("share-open");
                  setSharing(true);
                }}
                className={ITEM}
              >
                <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Share trip
              </button>
            )}
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
          {pathname === "/trips" && (
            <>
              <LightModeSwitch />
              <TextSizeChoice />
            </>
          )}
          <SavedOnlySwitch />
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
      {isOwner && <ShareTripDialog trip={trip} open={sharing} onClose={() => setSharing(false)} />}
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
