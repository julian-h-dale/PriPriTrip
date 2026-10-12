import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { MembersPanel } from "@/features/sharing/MembersPanel";

/** The owner's Share screen, from the drawer: who's on the trip (MembersPanel). */
export function ShareTripDialog({ trip, open, onClose }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share trip"
      description="Add someone by the email they sign in with."
    >
      <div className="flex flex-col gap-4">
        <MembersPanel tripId={trip.id} />
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
