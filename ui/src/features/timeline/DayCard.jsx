import { useState } from "react";
import { useDispatch } from "react-redux";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { ActivityForm } from "@/features/timeline/ActivityForm";
import { DayForm } from "@/features/timeline/DayForm";
import { dayHeadingId, dayId } from "@/features/timeline/dayIds";
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
import { cn } from "@/shared/utils/cn";
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
 * One date on the vertical timeline: a point on the rail and that day's card —
 * heading, summary and entries (activities plus stay/travel markers), with
 * editing of the day's activities and its own title/summary. The card is
 * collapsible; a date with nothing on it is a slim point with an Add action.
 */
export function DayCard({ row, index, trip, open, onToggleOpen, openEntries, onToggleEntry }) {
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

  const heading = formatDayHeading(row.date);

  const addButton = editable && (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      onClick={() => setForm({ item: null })}
      aria-label={`Add activity on ${heading}`}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add activity
    </Button>
  );

  return (
    <li id={dayId(row.date)} className="relative scroll-mt-28 pb-5 pl-7">
      {/* The rail: one continuous line down the left, a point per date. */}
      <span className="absolute bottom-0 left-[0.4375rem] top-0 w-px bg-border" aria-hidden="true" />
      <span
        className={cn(
          "absolute left-0 top-3.5 h-[0.9375rem] w-[0.9375rem] rounded-full border-2 border-background",
          empty ? "bg-muted-foreground/40" : "bg-primary"
        )}
        aria-hidden="true"
      />

      {empty && !row.summary ? (
        // A date with nothing on it is a slim point, not a full card.
        <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <p className="text-sm">
            <span className="font-medium" id={dayHeadingId(row.date)}>
              {row.title ?? heading}
            </span>{" "}
            <span className="text-muted-foreground">
              · {row.title ? `${heading} · ` : ""}
              {dayLabel} · No plans
            </span>
          </p>
          {addButton}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <header className="flex items-start gap-2 p-3">
            <button
              type="button"
              onClick={onToggleOpen}
              aria-expanded={open}
              aria-controls={`${dayId(row.date)}-body`}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {row.title ? `${heading} · ${dayLabel}` : dayLabel}
                </span>
                <h2 id={dayHeadingId(row.date)} className="break-words text-base font-semibold leading-snug">
                  {row.title ?? heading}
                </h2>
                {!open && (
                  <span className="text-xs text-muted-foreground">
                    {row.entries.length} {row.entries.length === 1 ? "entry" : "entries"}
                  </span>
                )}
              </span>
              <ChevronDown
                className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {editable && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => setDayFormOpen(true)}
                aria-label={`Edit ${heading} title and summary`}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Edit day</span>
              </Button>
            )}
          </header>

          {open && (
            <div
              id={`${dayId(row.date)}-body`}
              className={cn("flex flex-col gap-3 border-t border-border pb-3", !row.summary && "pt-0")}
            >
              {row.summary && (
                <Markdown className="px-3 pt-3 text-muted-foreground">{row.summary}</Markdown>
              )}
              {empty ? (
                <p className="px-3 pt-3 text-sm text-muted-foreground">Nothing planned for this day.</p>
              ) : (
                <ul
                  aria-label={`Plans for ${heading}`}
                  className={cn("border-b border-border", row.summary && "border-t")}
                >
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
              {addButton && <div className="px-3">{addButton}</div>}
            </div>
          )}
        </Card>
      )}

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
    </li>
  );
}
