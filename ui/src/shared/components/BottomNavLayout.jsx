import { useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { ArrowLeft, Search, UserPlus } from "lucide-react";
import { TripSearch } from "@/features/search/TripSearch";
import { ShareTripDialog } from "@/features/sharing/ShareTripDialog";
import { BottomNav } from "@/shared/components/BottomNav";
import { OfflineBar } from "@/shared/components/OfflineBar";
import { TopBar } from "@/shared/components/TopBar";

/**
 * Full-height shell for a trip-scoped page: scrollable content, with the
 * Timeline/Map tab bar pinned below it (never overlapping, no scroll-padding
 * guesswork) — used by the timeline, a day's page, and the map page. A top
 * bar (☰, the trip's name, search, plus any `actions`) sits above, then the
 * offline bar when the trip is the phone's saved copy.
 *
 * `backTo` (a path): a ← at the far right of the top bar, back up to that
 * page (a day's page goes back to the whole timeline).
 * `back` (a path): ← in ☰'s place instead, for a page you drill into (an
 * entry's page): back to where you came from, else to `back` (TopBar).
 */
export function BottomNavLayout({ tripId, actions, showTitle = true, backTo, back, children }) {
  const online = useSelector((s) => s.network?.online ?? true);
  const { stale, savedAt, trip } = useSelector((s) => s.timeline ?? {});
  const loaded = trip?.id === tripId ? trip : null;
  const [searchOpen, setSearchOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isOwner = loaded?.role === "owner";
  return (
    // Height excludes the notch padding #root adds in the installed app.
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top))] flex-col">
      <TopBar title={showTitle ? (loaded?.name ?? "") : ""} back={back}>
        {actions}
        {isOwner && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Share trip"
            className="rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserPlus className="h-5 w-5" aria-hidden="true" />
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
        {backTo && (
          <Link
            to={backTo}
            aria-label="Back to the timeline"
            className="rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        )}
      </TopBar>
      {loaded && <TripSearch trip={loaded} open={searchOpen} onClose={() => setSearchOpen(false)} />}
      {isOwner && <ShareTripDialog trip={loaded} open={shareOpen} onClose={() => setShareOpen(false)} />}
      <OfflineBar online={online} stale={stale} savedAt={savedAt} />
      {/* The page scrolls here, not the window; data-scroll-root lets a page
          find it (the day swiper scrolls it to the top after a swipe). */}
      <div data-scroll-root className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
      <BottomNav tripId={tripId} />
    </div>
  );
}
