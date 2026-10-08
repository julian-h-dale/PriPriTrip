import { CloudOff, RefreshCw } from "lucide-react";
import { formatSavedAt } from "@/shared/utils/time";

/**
 * A slim bar saying the page is the phone's saved copy, not live: offline, or
 * online but the server couldn't be reached. Renders nothing when live. It
 * doesn't say "read-only": trip edits are visibly off, but memories can
 * still be written (they wait in the outbox). With "Use saved copies only"
 * on (`savedOnly`), it says that instead of "Offline": it's on purpose, and
 * offers "Refresh once" (`onRefresh`) for one round of the network.
 */
export function OfflineBar({ online, stale, savedAt, savedOnly = false, onRefresh, refreshing = false }) {
  if (online && !stale) return null;
  const why = savedOnly ? "Saved copies only" : online ? "Can’t reach the server" : "Offline";
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {why}
        {savedAt && <> · {savedOnly ? "from" : "saved copy from"} {formatSavedAt(savedAt)}</>}
      </span>
      {savedOnly && onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="-my-1 inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 font-medium hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh once"}
        </button>
      )}
    </div>
  );
}
