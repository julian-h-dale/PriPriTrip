import { Pencil } from "lucide-react";
import { MODE_LABEL } from "@/features/timeline/describeEntry";
import { ConfirmationNumber, LocationBlock } from "@/features/timeline/TimelineEntry";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Markdown } from "@/shared/components/Markdown";
import { formatDayHeading, formatTime, zoneLabel } from "@/shared/utils/time";

function fullTime(wallClock, zone, tripZone) {
  const base = `${formatDayHeading(wallClock)} · ${formatTime(wallClock)}`;
  return zone === tripZone ? base : `${base} (${zoneLabel(zone)})`;
}

function Facts({ facts }) {
  if (!facts.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A quick, read-only look at an existing stay or leg — selecting a covered
 * date on the trip page's coverage views opens this, not the edit form
 * directly. "Edit" switches to the real form.
 */
export function BookingDetailsDialog({ open, onClose, onEdit, trip, kind, record }) {
  const isStay = kind === "stay";
  const tripZone = trip.timezone;

  return (
    <Dialog open={open} onClose={onClose} title={isStay ? record.name : record.title} className="max-w-lg">
      <div className="flex flex-col gap-4">
        {isStay ? (
          <>
            <Facts
              facts={[
                ["Check-in", fullTime(record.checkIn, record.zone ?? tripZone, tripZone)],
                ["Check-out", fullTime(record.checkOut, record.zone ?? tripZone, tripZone)],
                ["Room", record.roomType],
              ].filter(([, value]) => value)}
            />
            {record.location && <LocationBlock label="Where" loc={record.location} />}
          </>
        ) : (
          <>
            <Facts
              facts={[
                [MODE_LABEL[record.mode] ?? "Travel", [record.carrier, record.number].filter(Boolean).join(" ")],
                ["Departs", fullTime(record.depart, record.departZone ?? tripZone, tripZone)],
                [
                  "Arrives",
                  record.arrive ? fullTime(record.arrive, record.arriveZone ?? tripZone, tripZone) : "Not set yet",
                ],
              ].filter(([, value]) => value)}
            />
            {record.from && <LocationBlock label="From" loc={record.from} />}
            {record.to && <LocationBlock label="To" loc={record.to} />}
          </>
        )}

        {record.confirmationNumber && <ConfirmationNumber value={record.confirmationNumber} />}
        {record.notes && <Markdown className="text-muted-foreground">{record.notes}</Markdown>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
