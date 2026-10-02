import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { dayCities } from "@/features/timeline/dayCities";
import { dayId } from "@/features/timeline/dayIds";
import { RailDot } from "@/features/timeline/RailDot";
import { Markdown } from "@/shared/components/Markdown";
import { Card } from "@/shared/components/ui/card";
import { formatDayHeading } from "@/shared/utils/time";

const MUTED_DOT = "bg-muted-foreground/40";

/**
 * One date on the trip's vertical timeline: a point on the rail, beside
 * either a plain link to that date's own page ("plan" view — cities, title,
 * summary) or a button that opens that date's stay/travel directly ("stays"
 * or "travel" view, toggled on TripTimelinePage): the covering record for
 * editing, the add form when there's none, or — when a date has more than
 * one travel leg — the day page, where both are already listed.
 */
export function DayRow({ row, tripId, view = "plan", coverage, onSelect }) {
  const navigate = useNavigate();
  const heading = formatDayHeading(row.date);
  const to = `/trips/${tripId}/days/${row.date}`;

  if (view === "plan") {
    const empty = row.entries.length === 0;
    const blurb = [row.title && `**${row.title}**`, row.summary].filter(Boolean).join(" — ");

    // A click anywhere on the row navigates (except a link inside the
    // summary); the heading is also a real link, for keyboard and
    // screen-reader users.
    function handleClick(e) {
      if (e.target.closest("a")) return;
      navigate(to);
    }

    return (
      <li id={dayId(row.date)} className="relative scroll-mt-4 pb-3 pl-7">
        <RailDot colorClassName={empty ? MUTED_DOT : "bg-primary"} />
        <Card className="overflow-hidden">
          <div onClick={handleClick} className="flex cursor-pointer flex-col gap-1 p-3 hover:bg-accent/40">
            <Link
              to={to}
              className="flex w-full items-baseline gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <h2 className="shrink-0 text-base font-semibold leading-snug">{heading}</h2>
              <span className="min-w-0 flex-1 break-words text-right text-sm text-muted-foreground">
                {dayCities(row).join(" → ")}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
            </Link>
            {blurb && <Markdown className="text-muted-foreground">{blurb}</Markdown>}
          </div>
        </Card>
      </li>
    );
  }

  return (
    <li id={dayId(row.date)} className="relative scroll-mt-4 pb-3 pl-7">
      <RailDot colorClassName={coverage?.colorClass ?? MUTED_DOT} />
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => onSelect?.(row.date)}
          className="flex w-full items-baseline gap-3 p-3 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <h2 className="shrink-0 text-base font-semibold leading-snug">{heading}</h2>
          <span className="min-w-0 flex-1 break-words text-right text-sm text-muted-foreground">
            {coverage?.label ?? ""}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
        </button>
      </Card>
    </li>
  );
}
