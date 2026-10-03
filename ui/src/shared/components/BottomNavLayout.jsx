import { useSelector } from "react-redux";
import { BottomNav } from "@/shared/components/BottomNav";
import { OfflineBar } from "@/shared/components/OfflineBar";
import { TopBar } from "@/shared/components/TopBar";

/**
 * Full-height shell for a trip-scoped page: scrollable content, with the
 * Timeline/Map tab bar pinned below it (never overlapping, no scroll-padding
 * guesswork) — used by the timeline, a day's page, and the map page. A top
 * bar (☰ and the trip's name, plus `actions`) sits above, then the offline bar
 * when the trip is the phone's saved copy.
 */
export function BottomNavLayout({ tripId, actions, children }) {
  const online = useSelector((s) => s.network?.online ?? true);
  const { stale, savedAt, trip } = useSelector((s) => s.timeline ?? {});
  const title = trip?.id === tripId ? trip.name : "";
  return (
    // Height excludes the notch padding #root adds in the installed app.
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top))] flex-col">
      <TopBar title={title}>{actions}</TopBar>
      <OfflineBar online={online} stale={stale} savedAt={savedAt} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <BottomNav tripId={tripId} />
    </div>
  );
}
