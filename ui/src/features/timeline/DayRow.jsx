import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { dayCities } from "@/features/timeline/dayCities";
import { dayId } from "@/features/timeline/dayIds";
import { RailDot } from "@/features/timeline/RailDot";
import { Markdown } from "@/shared/components/Markdown";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { formatDayHeading } from "@/shared/utils/time";

const MUTED_DOT = "bg-muted-foreground/40";

function DayHeading({ heading, isToday }) {
  return (
    <h2 className="flex shrink-0 items-baseline gap-2 text-base font-semibold leading-snug">
      {heading}
      {isToday && (
        <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase leading-none text-primary-foreground">
          Today
        </span>
      )}
    </h2>
  );
}

/**
 * The date, its badge and what's on the right (cities, a stay, a leg). When
 * there isn't room for the right-hand words (a "Today" badge, a larger text
 * size), they drop to their own line under the date instead of being
 * squeezed to a sliver and broken mid-word.
 */
function RowHead({ heading, isToday, aside }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
        <DayHeading heading={heading} isToday={isToday} />
        {aside && (
          <span className="min-w-[min(100%,4.5rem)] flex-1 break-words text-right text-sm text-muted-foreground">{aside}</span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
    </>
  );
}

/**
 * One date on the trip's vertical timeline: a point on the rail, beside
 * either a plain link to that date's own page ("plan" view — cities, title,
 * summary) or a button that opens that date's stay/travel directly ("stays"
 * or "travel" view, toggled on TripTimelinePage): the covering record for
 * editing, the add form when there's none, or — when a date has more than
 * one travel leg — the day page, where both are already listed.
 *
 * `past` greys the row (it still opens); `isToday` marks it.
 */
export function DayRow({ row, tripId, view = "plan", coverage, onSelect, past = false, isToday = false }) {
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
        <RailDot colorClassName={empty || past ? MUTED_DOT : "bg-primary"} />
        <Card className={cn("overflow-hidden", past && "opacity-55", isToday && "border-primary")}>
          <div onClick={handleClick} className="flex cursor-pointer flex-col gap-1 p-3 hover:bg-accent/40">
            <Link
              to={to}
              className="flex w-full items-baseline gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RowHead heading={heading} isToday={isToday} aside={dayCities(row).join(" → ")} />
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
      <Card className={cn("overflow-hidden", past && "opacity-55", isToday && "border-primary")}>
        <button
          type="button"
          onClick={() => onSelect?.(row.date)}
          className="flex w-full items-baseline gap-3 p-3 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <RowHead heading={heading} isToday={isToday} aside={coverage?.label} />
        </button>
      </Card>
    </li>
  );
}
