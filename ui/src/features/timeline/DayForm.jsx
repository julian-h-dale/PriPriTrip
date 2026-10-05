import { useId, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { formatDayHeading } from "@/shared/utils/time";

/** Edit a day's title and summary. Both optional: an untitled day is headed by its date. */
export function DayForm({ open, onClose, date, day, onSave }) {
  const ids = useId();
  const [title, setTitle] = useState(day?.title ?? "");
  const [summary, setSummary] = useState(day?.summary ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    const payload = {};
    if (title.trim()) payload.title = title.trim();
    if (summary.trim()) payload.summary = summary;
    const result = await onSave(payload);
    setBusy(false);
    if (result.ok || result.reloaded) onClose(); // reloaded: someone else changed it
    else setError(result.errors?.[0]?.message ?? result.detail);
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Edit day"
      description={formatDayHeading(date)}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-title`}>Title</Label>
          <Input
            id={`${ids}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={formatDayHeading(date)}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-summary`}>Summary</Label>
          <Textarea
            id={`${ids}-summary`}
            rows={4}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Markdown supported</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
