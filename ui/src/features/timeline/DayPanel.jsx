import { useState } from "react";
import { useDispatch } from "react-redux";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { ActivityForm } from "@/features/timeline/ActivityForm";
import { DayForm } from "@/features/timeline/DayForm";
import { panelId, tabId } from "@/features/timeline/dayIds";
import {
  createItem,
  deleteItem,
  moveItem,
  replaceItem,
  updateDay,
} from "@/features/timeline/timelineSlice";
import { TimelineEntry } from "@/features/timeline/TimelineEntry";
import { Markdown } from "@/shared/components/Markdown";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { formatDayHeading } from "@/shared/utils/time";

/** Resolve an edit thunk to `{ ok }` or the server's `{ detail, errors }`. */
async function run(dispatch, thunk) {
  const result = await dispatch(thunk);
  return result.meta.requestStatus === "fulfilled"
    ? { ok: true }
    : { ok: false, ...(result.payload ?? { detail: "Couldn’t save", errors: [] }) };
}

function ActivityActions({ entry, busy, onEdit, onMove, onDelete }) {
  const title = entry.item.title;
  return (
    <div className="flex flex-wrap gap-1 border-t border-border pt-3">
      <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${title}`}>
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onMove("up")}
        disabled={busy || entry.index === 0}
        aria-label={`Move ${title} up`}
      >
        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        Up
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onMove("down")}
        disabled={busy || entry.index === entry.count - 1}
        aria-label={`Move ${title} down`}
      >
        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        Down
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-destructive hover:bg-destructive hover:text-destructive-foreground"
        onClick={onDelete}
        aria-label={`Delete ${title}`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </Button>
    </div>
  );
}

/**
 * One day of the timeline: its heading, summary and entries, plus editing of
 * the day's activities and its own title/summary. Stays and travel markers are
 * read-only here.
 */
export function DayPanel({ row, index, trip, openEntries, onToggleEntry, prev, next, onSelect }) {
  const dispatch = useDispatch();
  // `form` is null (closed), { item: null } (add) or { item } (edit).
  const [form, setForm] = useState(null);
  const [dayFormOpen, setDayFormOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const empty = row.entries.length === 0;
  const dayLabel = row.afterTrip ? "After the trip" : `Day ${index + 1}`;
  // Activities can only live on trip dates (not the morning-after row).
  const editable = !row.afterTrip;
  const day = trip.days.find((d) => d.date === row.date) ?? null;

  function saveActivity(payload) {
    const item = form?.item;
    return run(
      dispatch,
      item
        ? replaceItem({ tripId: trip.id, itemId: item.id, item: payload })
        : createItem({ tripId: trip.id, item: payload })
    );
  }

  async function move(item, direction) {
    setBusy(true);
    await dispatch(moveItem({ tripId: trip.id, itemId: item.id, direction }));
    setBusy(false);
  }

  async function confirmDelete() {
    setBusy(true);
    await dispatch(deleteItem({ tripId: trip.id, itemId: deleting.id }));
    setBusy(false);
    setDeleting(null);
  }

  return (
    <section
      id={panelId(row.date)}
      role="tabpanel"
      aria-labelledby={tabId(row.date)}
      className="flex flex-col gap-3"
    >
      {/* A date with no day entry is headed by its date; its entries say the rest. */}
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm text-muted-foreground">
            {row.title ? `${formatDayHeading(row.date)} · ${dayLabel}` : dayLabel}
          </p>
          <h2 className="break-words text-lg font-semibold leading-snug">
            {row.title ?? formatDayHeading(row.date)}
          </h2>
        </div>
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setDayFormOpen(true)}
            aria-label="Edit day title and summary"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit day
          </Button>
        )}
      </header>

      {row.summary && <Markdown className="text-muted-foreground">{row.summary}</Markdown>}

      <Card className="overflow-hidden">
        {empty ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing planned for this day.
          </p>
        ) : (
          <ul aria-label={`Plans for ${formatDayHeading(row.date)}`}>
            {row.entries.map((entry) => (
              <TimelineEntry
                key={entry.key}
                entry={entry}
                trip={trip}
                expanded={openEntries.has(`${row.date}:${entry.key}`)}
                onToggle={() => onToggleEntry(`${row.date}:${entry.key}`)}
                actions={
                  entry.kind === "activity" ? (
                    <ActivityActions
                      entry={entry}
                      busy={busy}
                      onEdit={() => setForm({ item: entry.item })}
                      onMove={(direction) => move(entry.item, direction)}
                      onDelete={() => setDeleting(entry.item)}
                    />
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {editable && (
        <Button variant="outline" className="self-start" onClick={() => setForm({ item: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add activity
        </Button>
      )}

      <nav className="flex justify-between" aria-label="Day navigation">
        {prev ? (
          <Button variant="ghost" size="sm" onClick={() => onSelect(prev.date)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {formatDayHeading(prev.date)}
          </Button>
        ) : (
          <span />
        )}
        {next && (
          <Button variant="ghost" size="sm" onClick={() => onSelect(next.date)}>
            {formatDayHeading(next.date)}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </nav>

      {form && (
        <ActivityForm
          key={form.item?.id ?? "new"}
          open
          onClose={() => setForm(null)}
          trip={trip}
          item={form.item}
          date={row.date}
          onSave={saveActivity}
        />
      )}

      {dayFormOpen && (
        <DayForm
          open
          onClose={() => setDayFormOpen(false)}
          date={row.date}
          day={day}
          onSave={(payload) =>
            run(dispatch, updateDay({ tripId: trip.id, date: row.date, day: payload }))
          }
        />
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => !busy && setDeleting(null)}
        title="Delete activity?"
        description={deleting ? `“${deleting.title}” will be removed from this day.` : ""}
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}
