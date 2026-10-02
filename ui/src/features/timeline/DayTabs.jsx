import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";
import { panelId, tabId } from "@/features/timeline/dayIds";
import { formatShortDate, formatWeekday } from "@/shared/utils/time";

/**
 * One tab per trip date, in a strip that scrolls sideways when the trip is
 * longer than the screen. ARIA tabs pattern: arrow keys / Home / End move
 * between days, and only the selected tab is in the tab order.
 */
export function DayTabs({ rows, selected, onSelect }) {
  const stripRef = useRef(null);

  // Keep the selected day visible when it changes (tap, keys, prev/next, URL).
  useEffect(() => {
    const tab = stripRef.current?.querySelector('[aria-selected="true"]');
    tab?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selected]);

  function onKeyDown(e) {
    const index = rows.findIndex((r) => r.date === selected);
    const target = {
      ArrowRight: Math.min(index + 1, rows.length - 1),
      ArrowLeft: Math.max(index - 1, 0),
      Home: 0,
      End: rows.length - 1,
    }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    onSelect(rows[target].date);
    stripRef.current?.querySelector(`#${tabId(rows[target].date)}`)?.focus();
  }

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Trip days"
      onKeyDown={onKeyDown}
      className="-mx-4 flex snap-x gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]"
    >
      {rows.map((row) => {
        const active = row.date === selected;
        return (
          <button
            key={row.date}
            id={tabId(row.date)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId(row.date)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(row.date)}
            className={cn(
              "flex w-[4.25rem] shrink-0 snap-start flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary/60"
            )}
          >
            <span className={cn("whitespace-nowrap text-xs", active ? "opacity-80" : "text-muted-foreground")}>
              {formatWeekday(row.date)}
            </span>
            <span className="whitespace-nowrap text-sm font-semibold">{formatShortDate(row.date)}</span>
            {/* A dimmed bar marks a date with nothing on it, so gaps show at a glance. */}
            <span
              className={cn(
                "mt-1 h-1 w-6 rounded-full",
                row.entries.length === 0 ? "bg-muted-foreground/30" : active ? "bg-primary-foreground/60" : "bg-primary/70"
              )}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
