import { CloudOff } from "lucide-react";
import { formatSavedAt } from "@/shared/utils/time";

/**
 * A slim bar saying the page is the phone's saved copy, not live: offline, or
 * online but the server couldn't be reached. Renders nothing when live. It
 * doesn't say "read-only": trip edits are visibly off, but memories can
 * still be written (they wait in the outbox). With "Use saved copies only"
 * on (`savedOnly`), it says that instead of "Offline": it's on purpose.
 */
export function OfflineBar({ online, stale, savedAt, savedOnly = false }) {
  if (online && !stale) return null;
  const why = savedOnly ? "Saved copies only" : online ? "Can’t reach the server" : "Offline";
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {why}
        {savedAt && <> · saved copy from {formatSavedAt(savedAt)}</>}
      </span>
    </div>
  );
}
