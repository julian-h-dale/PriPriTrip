import { CloudOff } from "lucide-react";
import { formatSavedAt } from "@/shared/utils/time";

/**
 * A slim bar saying the page is the phone's saved copy, not live: offline, or
 * online but the server couldn't be reached. Renders nothing when live.
 */
export function OfflineBar({ online, stale, savedAt }) {
  if (online && !stale) return null;
  const why = online ? "Can’t reach the server" : "Offline";
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {why} · read-only
        {savedAt && <> · saved copy from {formatSavedAt(savedAt)}</>}
      </span>
    </div>
  );
}
