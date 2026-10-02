import { BottomNav } from "@/shared/components/BottomNav";

/**
 * Full-height shell for a trip-scoped page: scrollable content, with the
 * Timeline/Map tab bar pinned below it (never overlapping, no scroll-padding
 * guesswork) — used by the timeline, a day's page, and the map page.
 */
export function BottomNavLayout({ tripId, children }) {
  return (
    <div className="flex h-dvh flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <BottomNav tripId={tripId} />
    </div>
  );
}
