import { cn } from "@/shared/utils/cn";

/**
 * The rail: a continuous line down the left with one dot per item. Shared by
 * the trip page's day rows and a day page's entry rows — same visual
 * language, just one level down (days -> entries within a day). The dot's
 * color is a bg-* class, so callers can pass a fixed tone (bg-primary,
 * bg-warning, bg-muted-foreground/40) or an arbitrary categorical color
 * (bg-series-N, see coverageView.js).
 */
export function RailDot({ colorClassName = "bg-primary" }) {
  return (
    <>
      <span className="absolute bottom-0 left-[0.4375rem] top-0 w-px bg-border" aria-hidden="true" />
      <span
        className={cn(
          "absolute left-0 top-4 h-[0.9375rem] w-[0.9375rem] rounded-full border-2 border-background",
          colorClassName
        )}
        aria-hidden="true"
      />
    </>
  );
}
