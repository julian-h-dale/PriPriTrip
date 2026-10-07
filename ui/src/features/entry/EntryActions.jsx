import { useState } from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { ActivityForm } from "@/features/timeline/ActivityForm";
import { runEdit } from "@/features/timeline/runEdit";
import { StayForm } from "@/features/timeline/StayForm";
import { TravelForm } from "@/features/timeline/TravelForm";
import { deleteItem, deleteStay, deleteTravel, replaceItem, replaceStay, replaceTravel } from "@/features/timeline/timelineSlice";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { keepFirstEntry } from "@/shared/utils/firstEntry";

const NOUN = { activity: "activity", stay: "stay", travel: "travel" };

function deleteMessage({ kind, record }) {
  if (kind === "activity") return `“${record.title}” will be removed from its day.`;
  if (kind === "stay") return `“${record.name}” will be removed from every day it covers.`;
  return `“${record.title}” will be removed from the timeline.`;
}

/**
 * Edit and Delete on an entry's page (editors; a viewer never gets here).
 * Edit opens the same form as anywhere else, over the page; Delete asks,
 * then goes to the entry's day. Offline (`readOnly`) greys both. A conflict
 * (someone else changed it) is handled by the slice: a warning, the trip
 * reloads, the form closes, and the page shows the latest.
 */
export function EntryActions({ trip, found, readOnly }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { kind, record, date } = found;
  const tripId = trip.id;

  function save(payload) {
    const thunk =
      kind === "activity"
        ? replaceItem({ tripId, itemId: record.id, item: payload, version: record.version })
        : kind === "stay"
          ? replaceStay({ tripId, stayId: record.id, stay: payload, version: record.version })
          : replaceTravel({ tripId, travelId: record.id, travel: payload, version: record.version });
    return runEdit(dispatch, thunk);
  }

  async function confirmDelete() {
    setBusy(true);
    const result = await dispatch(
      kind === "activity"
        ? deleteItem({ tripId, itemId: record.id, version: record.version })
        : kind === "stay"
          ? deleteStay({ tripId, stayId: record.id, version: record.version })
          : deleteTravel({ tripId, travelId: record.id, version: record.version })
    );
    setBusy(false);
    setDeleting(false);
    if (result.meta.requestStatus === "fulfilled") navigate(`/trips/${tripId}/days/${date}`, { replace: true, state: keepFirstEntry(location) });
  }

  const offline = readOnly ? "You’re offline" : undefined;
  const formProps = { open: true, onClose: () => setEditing(false), trip, date, onSave: save };
  return (
    <>
      <div className="flex gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={() => setEditing(true)} disabled={readOnly} title={offline}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit {NOUN[kind]}
        </Button>
        <Button
          variant="ghost"
          className="ml-auto text-destructive hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => setDeleting(true)}
          disabled={readOnly}
          title={offline}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      </div>

      {editing && kind === "activity" && <ActivityForm {...formProps} item={record} />}
      {editing && kind === "stay" && <StayForm {...formProps} stay={record} />}
      {editing && kind === "travel" && <TravelForm {...formProps} travel={record} />}

      <Dialog
        open={deleting}
        onClose={() => !busy && setDeleting(false)}
        title={`Delete ${NOUN[kind]}?`}
        description={deleteMessage(found)}
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleting(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
