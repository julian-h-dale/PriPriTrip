import { AlertTriangle, ChevronDown } from "lucide-react";
import { describeEntry } from "@/features/timeline/describeEntry";
import { EntryDetails } from "@/features/timeline/EntryDetails";
import { RailDot } from "@/features/timeline/RailDot";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { datePart, formatTime, zoneLabel } from "@/shared/utils/time";

function TimeColumn({ d, tripZone }) {
  if (!d.start) return <span className="text-xs text-muted-foreground">—</span>;
  const showZone = d.zone !== tripZone;
  const showEndZone = d.end && d.endZone && d.endZone !== d.zone;
  return (
    <span className="flex flex-col text-xs leading-tight">
      <span className="font-medium text-foreground">{formatTime(d.start)}</span>
      {showZone && <span className="text-muted-foreground">{zoneLabel(d.zone)}</span>}
      {d.end && (
        <span className="text-muted-foreground">
          – {formatTime(d.end)}
          {datePart(d.end) > datePart(d.start) && <sup className="ml-0.5">+1</sup>}
        </span>
      )}
      {showEndZone && <span className="text-muted-foreground">{zoneLabel(d.endZone)}</span>}
    </span>
  );
}

/**
 * One timeline row. `actions` (edit/move/delete for an activity) shows at the
 * bottom of the expanded details, which also makes an otherwise bare activity
 * expandable. Markers (stays, travel) never get actions.
 */
export function TimelineEntry({ entry, trip, expanded, onToggle, actions }) {
  const d = describeEntry(entry, trip);
  const Icon = d.icon;
  const hasDetails = Boolean(
    actions || d.notes || d.confirmation || d.locations.length || d.facts.length
  );

  const summary = (
    <>
      <span className="w-[4.5rem] shrink-0 pt-0.5">
        <TimeColumn d={d} tripZone={trip.timezone} />
      </span>
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background",
          entry.kind === "activity" ? "text-primary" : "text-warning",
          d.muted && "text-muted-foreground"
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("break-words text-sm font-medium", d.muted && "font-normal text-muted-foreground")}>
          {d.title}
        </span>
        {d.subtitle && <span className="break-words text-xs text-muted-foreground">{d.subtitle}</span>}
        {d.warning && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {d.warning}
          </span>
        )}
      </span>
      {hasDetails && (
        <ChevronDown
          className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      )}
    </>
  );

  return (
    <li className="relative pb-3 pl-7">
      <RailDot colorClassName={entry.kind === "activity" ? "bg-primary" : "bg-warning"} />
      <Card className="overflow-hidden">
        {hasDetails ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {summary}
          </button>
        ) : (
          <div className="flex items-start gap-3 px-3 py-2.5">{summary}</div>
        )}

        {hasDetails && expanded && (
          <div className="flex flex-col gap-3 border-t border-border px-3 pb-3 pt-3 sm:pl-[8.25rem]">
            <EntryDetails d={d} />
            {actions}
          </div>
        )}
      </Card>
    </li>
  );
}
