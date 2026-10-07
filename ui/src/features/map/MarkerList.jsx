import { useState } from "react";
import { List } from "lucide-react";
import { iconFor } from "@/features/map/mapStyle";
import { groupMarkers, markerSubtitle } from "@/features/map/markerList";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";

/**
 * The map's List button (Run stage 16), at the bottom left just above
 * Google's logo: a dialog of the markers on the map now (after the Filter
 * and the day), grouped by kind, each with its icon, name and where it is.
 * Choosing one closes the list and jumps to it (`onSelect(marker)`: zoom in,
 * open its info window). Nothing is added from here.
 */
export function MarkerList({ markers, onSelect }) {
  const [open, setOpen] = useState(false);
  const groups = groupMarkers(markers);

  function choose(marker) {
    setOpen(false);
    onSelect(marker);
  }

  return (
    <>
      {/* bottom-8: clear of Google's logo and attribution, which must stay visible. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute bottom-8 left-2 z-10 rounded-full border border-border bg-card shadow-md"
        aria-label="List what's on the map"
        onClick={() => setOpen(true)}
      >
        <List className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="On the map">
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing on the map with these filters.</p>
          ) : (
            groups.map((group) => (
              <section key={group.kind} aria-label={group.label} className="mb-3 last:mb-0">
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h3>
                <ul className="flex flex-col">
                  {group.markers.map((marker) => {
                    const Icon = iconFor(marker);
                    const subtitle = markerSubtitle(marker);
                    return (
                      <li key={marker.id}>
                        <button
                          type="button"
                          onClick={() => choose(marker)}
                          className="flex min-h-11 w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="break-words text-sm">{marker.title}</span>
                            {subtitle && <span className="break-words text-xs text-muted-foreground">{subtitle}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
