import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import { entryPathFor } from "@/features/entry/entries";
import { searchTrip } from "@/features/search/tripSearch";
import { describeEntry } from "@/features/timeline/describeEntry";
import { Input } from "@/shared/components/ui/input";
import { formatDayHeading } from "@/shared/utils/time";

/**
 * Full-screen search over one trip. Results are grouped by day; picking one
 * opens that entry's own page (a day's summary opens the day). All on the
 * device — works offline.
 */
export function TripSearch({ trip, open, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const groups = useMemo(() => searchTrip(trip, query), [trip, query]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const dayUrl = (date) => `/trips/${trip.id}/days/${date}`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Search ${trip.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            type="search"
            aria-label="Search this trip"
            placeholder="Hotel, flight number, confirmation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear"
              className="absolute right-1 top-1 rounded-sm p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-4">
          {query.trim() && groups.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing on this trip matches “{query.trim()}”.</p>
          )}
          {groups.map((group) => (
            <section key={group.date} aria-label={formatDayHeading(group.date)}>
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {formatDayHeading(group.date)}
              </h2>
              <ul className="flex flex-col gap-1.5">
                {group.day && (
                  <li>
                    <Link
                      to={dayUrl(group.date)}
                      onClick={onClose}
                      className="block rounded-md border border-border bg-card px-3 py-2.5 text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="line-clamp-2 text-muted-foreground">{group.day}</span>
                    </Link>
                  </li>
                )}
                {group.results.map((r) => {
                  const Icon = describeEntry(r.entry, trip).icon;
                  return (
                    <li key={r.key}>
                      <Link
                        to={entryPathFor(trip.id, r.entry)}
                        state={{ atKey: r.entry.key }}
                        onClick={onClose}
                        className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2.5 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="break-words text-sm font-medium">{r.title}</span>
                          {r.where ? (
                            <span className="break-words text-xs text-muted-foreground">{r.where}</span>
                          ) : (
                            r.subtitle && <span className="break-words text-xs text-muted-foreground">{r.subtitle}</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
