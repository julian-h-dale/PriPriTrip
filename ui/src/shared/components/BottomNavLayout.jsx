import { useSelector } from "react-redux";
import { BottomNav } from "@/shared/components/BottomNav";
import { OfflineBar } from "@/shared/components/OfflineBar";

/**
 * Full-height shell for a trip-scoped page: scrollable content, with the
 * Timeline/Map tab bar pinned below it (never overlapping, no scroll-padding
 * guesswork) — used by the timeline, a day's page, and the map page. The
 * offline bar sits above the content when the trip is the phone's saved copy.
 */
export function BottomNavLayout({ tripId, children }) {
  const online = useSelector((s) => s.network?.online ?? true);
  const { stale, savedAt } = useSelector((s) => s.timeline ?? {});
  return (
    // Height excludes the notch padding #root adds in the installed app.
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top))] flex-col">
      <OfflineBar online={online} stale={stale} savedAt={savedAt} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <BottomNav tripId={tripId} />
    </div>
  );
}
