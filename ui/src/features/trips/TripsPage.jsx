import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { BedDouble, ChevronDown, LogOut, Plane, Trash2, Upload, UserPlus, Users } from "lucide-react";
import { JoinTripDialog } from "@/features/sharing/JoinTripDialog";
import { deleteTrip, fetchTrips, leaveTrip } from "@/features/trips/tripsSlice";
import { ImportTripDialog } from "@/features/trips/ImportTripDialog";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { OfflineBar } from "@/shared/components/OfflineBar";
import { RowMenu } from "@/shared/components/RowMenu";
import { TopBar } from "@/shared/components/TopBar";
import { cn } from "@/shared/utils/cn";
import { daysBetween, formatDateRange } from "@/shared/utils/time";
import { groupTrips } from "@/shared/utils/tripDates";

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function TripCard({ trip, onDelete, onLeave, readOnly }) {
  const shared = trip.role === "viewer";
  const nights = daysBetween(trip.startDate, trip.endDate);
  return (
    <Card className="flex items-stretch transition-colors hover:border-primary/60">
      <Link
        to={`/trips/${trip.id}`}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-l-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="break-words font-semibold leading-snug">{trip.name}</span>
        {shared && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Shared with you
          </span>
        )}
        <span className="text-sm text-muted-foreground">
          {formatDateRange(trip.startDate, trip.endDate)} · {plural(nights, "night")}
        </span>
        <span className="flex gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <BedDouble className="h-3.5 w-3.5" aria-hidden="true" />
            {plural(trip.stayCount, "stay")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Plane className="h-3.5 w-3.5" aria-hidden="true" />
            {plural(trip.travelCount, "leg")}
          </span>
        </span>
      </Link>
      {/* Delete (or Leave, for a shared trip) lives behind ⋯, away from the
          card's main tap target. */}
      <div className="flex items-start p-1.5">
        <RowMenu
          label={`More for ${trip.name}`}
          items={[
            shared
              ? {
                  label: "Leave trip",
                  icon: <LogOut className="h-4 w-4" aria-hidden="true" />,
                  destructive: true,
                  disabled: readOnly,
                  title: readOnly ? "You’re offline" : undefined,
                  onSelect: () => onLeave(trip),
                }
              : {
                  label: "Delete trip",
                  icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                  destructive: true,
                  disabled: readOnly,
                  title: readOnly ? "You’re offline" : undefined,
                  onSelect: () => onDelete(trip),
                },
          ]}
        />
      </div>
    </Card>
  );
}

/** One group of the trips list: a heading, then its cards. */
function TripGroup({ title, trips, onDelete, onLeave, readOnly }) {
  if (!trips.length) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <ul className="flex flex-col gap-2">
        {trips.map((trip) => (
          <li key={trip.id}>
            <TripCard trip={trip} onDelete={onDelete} onLeave={onLeave} readOnly={readOnly} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TripListSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-label="Loading trips">
      {[0, 1].map((i) => (
        <li key={i} className="h-[92px] animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </ul>
  );
}

export function TripsPage() {
  const dispatch = useDispatch();
  const { items, status, stale, savedAt } = useSelector((s) => s.trips);
  const online = useSelector((s) => s.network?.online ?? true);
  const readOnly = !online || stale;
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(null);
  const [leaving, setLeaving] = useState(false);

  // Re-runs when the connection comes back (or drops — which falls back to
  // the saved copy and marks it stale).
  useEffect(() => {
    dispatch(fetchTrips());
  }, [dispatch, online]);

  async function confirmLeave() {
    setLeaving(true);
    await dispatch(leaveTrip(pendingLeave.id));
    setLeaving(false);
    setPendingLeave(null);
  }

  async function confirmDelete() {
    setDeleting(true);
    await dispatch(deleteTrip(pendingDelete.id));
    setDeleting(false);
    setPendingDelete(null);
  }

  const firstLoad = status === "loading" && items.length === 0;
  const groups = groupTrips(items);

  return (
    <>
      <TopBar title="PriPriTrip" />
      <OfflineBar online={online} stale={stale} savedAt={savedAt} />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Trips</h1>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setJoinOpen(true)}
              disabled={readOnly}
              title={readOnly ? "You’re offline" : undefined}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Join trip
            </Button>
            {items.length > 0 && (
              <Button
                size="sm"
                onClick={() => setImportOpen(true)}
                disabled={readOnly}
                title={readOnly ? "You’re offline" : undefined}
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                Import trip
              </Button>
            )}
          </div>
        </div>

        {firstLoad ? (
          <TripListSkeleton />
        ) : status === "failed" && items.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">Couldn’t load your trips</p>
            <p className="text-sm text-muted-foreground">
              {online ? "The server didn’t answer." : "You’re offline, and no trips are saved on this device yet."}
            </p>
            <Button variant="outline" onClick={() => dispatch(fetchTrips())}>
              Try again
            </Button>
          </Card>
        ) : items.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-medium">No trips yet</p>
            <p className="text-sm text-muted-foreground">
              Import a trip document to see it as a timeline.
            </p>
            <Button onClick={() => setImportOpen(true)} disabled={readOnly}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import trip
            </Button>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            <TripGroup title="Active" trips={groups.active} onDelete={setPendingDelete} onLeave={setPendingLeave} readOnly={readOnly} />
            <TripGroup title="Upcoming" trips={groups.upcoming} onDelete={setPendingDelete} onLeave={setPendingLeave} readOnly={readOnly} />
            {groups.past.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowPast((v) => !v)}
                  aria-expanded={showPast}
                  className="flex items-center gap-1 self-start rounded-sm py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Past ({groups.past.length})
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showPast && "rotate-180")} aria-hidden="true" />
                </button>
                {showPast && (
                  <ul aria-label="Past" className="flex flex-col gap-2">
                    {groups.past.map((trip) => (
                      <li key={trip.id}>
                        <TripCard trip={trip} onDelete={setPendingDelete} onLeave={setPendingLeave} readOnly={readOnly} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <ImportTripDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <JoinTripDialog open={joinOpen} onClose={() => setJoinOpen(false)} />

        <Dialog
          open={pendingLeave !== null}
          onClose={() => !leaving && setPendingLeave(null)}
          title="Leave trip?"
          description={
            pendingLeave
              ? `“${pendingLeave.name}” will leave your trips. You can join again with its id.`
              : ""
          }
        >
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLeave(null)} disabled={leaving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmLeave} disabled={leaving}>
              {leaving ? "Leaving…" : "Leave"}
            </Button>
          </DialogFooter>
        </Dialog>

        <Dialog
          open={pendingDelete !== null}
          onClose={() => !deleting && setPendingDelete(null)}
          title="Delete trip?"
          description={pendingDelete ? `“${pendingDelete.name}” will be removed from your trips.` : ""}
        >
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </Dialog>
      </div>
    </>
  );
}
