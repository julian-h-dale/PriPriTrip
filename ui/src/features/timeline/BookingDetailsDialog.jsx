import { Pencil } from "lucide-react";
import { describeEntry } from "@/features/timeline/describeEntry";
import { EntryDetails } from "@/features/timeline/EntryDetails";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";

/**
 * A quick, read-only look at an existing stay or leg — selecting a covered
 * date on the trip page's coverage views opens this, not the edit form
 * directly. "Edit" switches to the real form. The details are the same
 * `EntryDetails` the day page shows, so they read the same everywhere.
 */
export function BookingDetailsDialog({ open, onClose, onEdit, trip, kind, record, readOnly = false }) {
  const isStay = kind === "stay";
  // Described as its check-in / departure: the whole booking's facts.
  const entry = isStay
    ? { kind: "stay", phase: "check-in", stay: record }
    : { kind: "travel", phase: "depart", travel: record, overnight: false };
  const d = describeEntry(entry, trip);
  // A stay's photo becomes the dialog's hero (so no thumbnail as well).
  // Legs stay plain: airport and station photos aren't shown (describeEntry).
  const hero = d.photos ? (record.location?.imgRef ?? null) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isStay ? record.name : record.title}
      className="max-w-lg"
      heroImage={hero}
    >
      <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
        <EntryDetails d={hero ? { ...d, photos: false } : d} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onEdit} disabled={readOnly} title={readOnly ? "You’re offline" : undefined}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
