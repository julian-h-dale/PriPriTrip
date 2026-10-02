import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { BedDouble, Plane, Trash2, Upload } from "lucide-react";
import { clearAuth } from "@/features/auth/authSlice";
import { deleteTrip, fetchTrips } from "@/features/trips/tripsSlice";
import { ImportTripDialog } from "@/features/trips/ImportTripDialog";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { daysBetween, formatDateRange } from "@/shared/utils/time";

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function TripCard({ trip, onDelete }) {
  const nights = daysBetween(trip.startDate, trip.endDate);
  return (
    <Card className="flex items-stretch transition-colors hover:border-primary/60">
      <Link
        to={`/trips/${trip.id}`}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-l-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="break-words font-semibold leading-snug">{trip.name}</span>
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
      <div className="flex items-start p-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${trip.name}`}
          onClick={() => onDelete(trip)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </Card>
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
  const navigate = useNavigate();
  const { items, status } = useSelector((s) => s.trips);
  const user = useSelector((s) => s.auth.user);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    dispatch(fetchTrips());
  }, [dispatch]);

  async function confirmDelete() {
    setDeleting(true);
    await dispatch(deleteTrip(pendingDelete.id));
    setDeleting(false);
    setPendingDelete(null);
  }

  const firstLoad = status === "loading" && items.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Trips</h1>
          {user?.email && (
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Only rendered for admins; the server still enforces access. */}
          {user?.is_superuser && (
            <Button variant="outline" size="sm" onClick={() => navigate("/admin")}>
              Admin
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => dispatch(clearAuth())}>
            Sign out
          </Button>
        </div>
      </header>

      {items.length > 0 && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import trip
          </Button>
        </div>
      )}

      {firstLoad ? (
        <TripListSkeleton />
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-medium">No trips yet</p>
          <p className="text-sm text-muted-foreground">
            Import a trip document to see it as a timeline.
          </p>
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import trip
          </Button>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((trip) => (
            <li key={trip.id}>
              <TripCard trip={trip} onDelete={setPendingDelete} />
            </li>
          ))}
        </ul>
      )}

      <ImportTripDialog open={importOpen} onClose={() => setImportOpen(false)} />

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
  );
}
