import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { TopBar } from "@/shared/components/TopBar";

/**
 * A trip tool's page (Weather, Currency): the top bar with ☰ and the tool's
 * name, a way back to the trip, and the content. No tab bar — the tools live
 * in the drawer, not beside the trip's own tabs.
 */
export function ToolLayout({ tripId, title, children }) {
  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col">
      <TopBar title={title}>
        <Link
          to={`/trips/${tripId}/today`}
          aria-label="Back to the trip"
          className="rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
      </TopBar>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">{children}</main>
    </div>
  );
}
