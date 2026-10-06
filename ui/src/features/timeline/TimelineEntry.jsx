import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { entryPathFor } from "@/features/entry/entries";
import { describeEntry } from "@/features/timeline/describeEntry";
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
 * One timeline row: a link to the entry's own page (Run stage 13), where its
 * details and Edit / Delete live. A stay or leg marker opens its booking; an
 * arrival opens the same leg. `menu` (a RowMenu, on the day page for
 * editors) sits beside the link, for moving an activity up or down.
 */
export function TimelineEntry({ entry, trip, menu }) {
  const d = describeEntry(entry, trip);
  const Icon = d.icon;
  return (
    <li id={`entry-${entry.key}`} className="relative scroll-mt-16 pb-3 pl-7">
      <RailDot colorClassName={entry.kind === "activity" ? "bg-primary" : "bg-warning"} />
      <Card className="flex items-start overflow-hidden">
        <Link
          to={entryPathFor(trip.id, entry)}
          className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
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
          {!menu && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </Link>
        {menu && <div className="shrink-0 py-0.5 pr-0.5">{menu}</div>}
      </Card>
    </li>
  );
}
