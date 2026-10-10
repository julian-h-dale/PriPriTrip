import { useState } from "react";
import { Link } from "react-router-dom";
import { mapFocusPath } from "@/features/map/mapFocus";
import { NEARBY_SHOWN, milesLabel, nearbyPointsOfInterest } from "@/features/pointsOfInterest/nearby";
import { POI_CATEGORY_LABEL, POI_ICON } from "@/features/pointsOfInterest/pointsOfInterest";

/**
 * "Nearby" on an activity's or stay's page (Run stage 27): the trip's points
 * of interest within half a mile of its place, closest first. Each row opens
 * the map at that pin. Nothing at all when none are near.
 */
export function NearbyPointsOfInterest({ trip, location, labelClassName }) {
  const [all, setAll] = useState(false);
  const nearby = nearbyPointsOfInterest(trip, location);
  if (nearby.length === 0) return null;
  const shown = all ? nearby : nearby.slice(0, NEARBY_SHOWN);
  return (
    <section aria-label="Nearby" className="flex flex-col gap-1">
      <span className={labelClassName}>Nearby</span>
      <ul className="-mx-2 flex flex-col">
        {shown.map(({ poi, metres }) => {
          const Icon = POI_ICON[poi.category] ?? POI_ICON.other;
          return (
            <li key={poi.id}>
              <Link
                to={mapFocusPath(trip.id, `poi-${poi.id}`)}
                className="flex min-h-11 items-start gap-3 rounded-md px-2 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words text-sm">{poi.name}</span>
                  <span className="text-xs text-muted-foreground">{POI_CATEGORY_LABEL[poi.category] ?? "Other"}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{milesLabel(metres)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {!all && nearby.length > NEARBY_SHOWN && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 self-start text-sm text-primary underline-offset-2 hover:underline"
        >
          Show all {nearby.length}
        </button>
      )}
    </section>
  );
}
