import { TopBar } from "@/shared/components/TopBar";

/**
 * A trip tool's page (Weather, Currency, Packing, Documents), opened from the
 * drawer: the top bar has ← (back to where you were, else the trip) in ☰'s
 * place, then the content. No tab bar — the tools live in the drawer, not
 * beside the trip's own tabs.
 */
export function ToolLayout({ tripId, title, children }) {
  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col">
      <TopBar title={title} back={`/trips/${tripId}/today`} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">{children}</main>
    </div>
  );
}
