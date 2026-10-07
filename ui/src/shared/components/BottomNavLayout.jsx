import { useState } from "react";
import { useSelector } from "react-redux";
import { NotebookPen, Search } from "lucide-react";
import { MemoryDialog } from "@/features/journal/MemoryDialog";
import { canWriteMemories } from "@/features/journal/journalSlice";
import { TripSearch } from "@/features/search/TripSearch";
import { BottomNav } from "@/shared/components/BottomNav";
import { OfflineBar } from "@/shared/components/OfflineBar";
import { TopBar } from "@/shared/components/TopBar";
import { selectOnline, selectSavedOnly } from "@/shared/networkSlice";

/**
 * Full-height shell for a trip-scoped page: scrollable content, with the
 * Timeline/Map tab bar pinned below it (never overlapping, no scroll-padding
 * guesswork) — used by the timeline, a day's page, and the map page. A top
 * bar (☰, the trip's name, New memory, search, plus any `actions`) sits
 * above, then the offline bar when the trip is the phone's saved copy.
 * Sharing the trip is in the drawer (☰).
 *
 * `back` (a path): ← in ☰'s place, for a page you drill into (a day, an
 * entry): back to where you came from, else to `back` (TopBar).
 */
export function BottomNavLayout({ tripId, actions, showTitle = true, back, children }) {
  const online = useSelector(selectOnline);
  const savedOnly = useSelector(selectSavedOnly);
  const { stale, savedAt, trip } = useSelector((s) => s.timeline ?? {});
  const loaded = trip?.id === tripId ? trip : null;
  const [searchOpen, setSearchOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  return (
    // Height excludes the notch padding #root adds in the installed app.
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top))] flex-col">
      <TopBar title={showTitle ? (loaded?.name ?? "") : ""} back={back}>
        {actions}
        {/* Spur of the moment: one tap to write it down, from any trip page.
            Filled blue, so it stands out from the grey icons. Always there
            for a writer: offline, memories wait in the outbox. */}
        {canWriteMemories(loaded) && (
          <button
            type="button"
            onClick={() => setWriting(true)}
            aria-label="New memory"
            className="rounded-md bg-primary p-2.5 text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <NotebookPen className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {loaded && (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search this trip"
            className="rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </TopBar>
      {loaded && <TripSearch trip={loaded} open={searchOpen} onClose={() => setSearchOpen(false)} />}
      {writing && <MemoryDialog open onClose={() => setWriting(false)} tripId={tripId} />}
      <OfflineBar savedOnly={savedOnly} online={online} stale={stale} savedAt={savedAt} />
      {/* The page scrolls here, not the window; data-scroll-root lets a page
          find it (the day swiper scrolls it to the top after a swipe). */}
      <div data-scroll-root className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
      <BottomNav tripId={tripId} />
    </div>
  );
}
