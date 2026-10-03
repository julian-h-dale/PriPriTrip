import { useId, useState } from "react";
import { useDispatch } from "react-redux";
import { createMemory, updateMemory } from "@/features/journal/journalSlice";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";

const MAX = 2000;

/**
 * Write a memory, or change the words of one of yours. Its time is stamped
 * by the server when it's first saved, and editing never changes it.
 */
export function MemoryDialog({ open, onClose, tripId, memory = null }) {
  const dispatch = useDispatch();
  const ids = useId();
  const [text, setText] = useState(memory?.text ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const trimmed = text.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!trimmed) {
      setError("Write something to remember.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await dispatch(
      memory ? updateMemory({ tripId, id: memory.id, text: trimmed }) : createMemory({ tripId, text: trimmed })
    );
    setBusy(false);
    if (result.meta.requestStatus === "fulfilled") onClose();
    else setError(result.payload);
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title={memory ? "Edit memory" : "New memory"}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-text`}>What happened?</Label>
          <Textarea
            id={`${ids}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={MAX}
            placeholder="A meal, a museum, a funny joke…"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-hint`}
            autoFocus
          />
          <p id={`${ids}-hint`} className="flex justify-between gap-2 text-xs text-muted-foreground">
            {error ? (
              <span role="alert" className="text-destructive">
                {error}
              </span>
            ) : (
              <span>{memory ? "Its time stays as first written." : "Saved with the time right now."}</span>
            )}
            <span>
              {text.length}/{MAX}
            </span>
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !trimmed}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
