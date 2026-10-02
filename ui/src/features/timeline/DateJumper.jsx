import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";
import { formatShortDate, formatWeekday } from "@/shared/utils/time";

/**
 * A compact, sticky strip of the trip's dates. Tapping one scrolls the
 * timeline to that day; the day currently in view is highlighted
 * (`aria-current`). Scrolls sideways when the trip is longer than the screen.
 */
export function DateJumper({ rows, current, onJump }) {
  const stripRef = useRef(null);

  // Keep the highlighted date visible in the strip as the page scrolls.
  useEffect(() => {
    const active = stripRef.current?.querySelector('[aria-current="true"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [current]);

  return (
    <nav aria-label="Jump to a day">
      <div ref={stripRef} className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]">
        {rows.map((row) => {
          const active = row.date === current;
          return (
            <button
              key={row.date}
              type="button"
              onClick={() => onJump(row.date)}
              aria-current={active ? "true" : undefined}
              aria-label={`Jump to ${formatWeekday(row.date)}, ${formatShortDate(row.date)}`}
              className={cn(
                "flex w-14 shrink-0 flex-col items-center rounded-md border px-1 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/60",
                row.entries.length === 0 && !active && "text-muted-foreground"
              )}
            >
              <span className={cn("text-[0.65rem] leading-tight", active ? "opacity-80" : "text-muted-foreground")}>
                {formatWeekday(row.date)}
              </span>
              <span className="whitespace-nowrap text-xs font-semibold">{formatShortDate(row.date)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
