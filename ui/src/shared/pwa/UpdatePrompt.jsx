import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

/**
 * "Update available · Reload" — a new version is installed and waiting. Never
 * reloads on its own, so an open form is never lost; it stays until acted on.
 */
export function UpdatePrompt({ needRefresh, onReload, onDismiss }) {
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-sm items-center gap-3 rounded-md border border-primary/50 bg-card px-4 py-2.5 text-sm shadow-lg"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1">Update available</span>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Later
      </Button>
      <Button size="sm" onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}
