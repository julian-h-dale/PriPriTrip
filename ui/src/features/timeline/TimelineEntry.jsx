import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, MapPin } from "lucide-react";
import { describeEntry } from "@/features/timeline/describeEntry";
import { RailDot } from "@/features/timeline/RailDot";
import { Markdown } from "@/shared/components/Markdown";
import { MiniMap } from "@/shared/components/MiniMap";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { datePart, formatTime, zoneLabel } from "@/shared/utils/time";

function mapsUrl(loc) {
  if (loc.lat != null && loc.lng != null) {
    const placeId = loc.placeId ? `&query_place_id=${encodeURIComponent(loc.placeId)}` : "";
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}${placeId}`;
  }
  if (loc.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${loc.name}, ${loc.address}`)}`;
  }
  return null;
}

export function LocationBlock({ label, loc }) {
  const map = mapsUrl(loc);
  // Photos are Google-hosted and not cached offline: hide one that can't load
  // rather than show a broken image.
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{loc.name}</span>
      {loc.address && <span className="text-xs text-muted-foreground">{loc.address}</span>}
      {loc.imgRef ? (
        !photoFailed && (
          <img
            src={loc.imgRef}
            alt=""
            className="h-28 w-full rounded-md object-cover"
            onError={() => setPhotoFailed(true)}
          />
        )
      ) : (
        <MiniMap lat={loc.lat} lng={loc.lng} className="h-28 w-full" />
      )}
      {(map || loc.url) && (
        <span className="flex gap-3 text-xs">
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              Open map
            </a>
          )}
          {loc.url && (
            <a href={loc.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Website
            </a>
          )}
        </span>
      )}
    </div>
  );
}

export function ConfirmationNumber({ value }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the number is still on screen to copy by hand.
    }
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Confirmation</span>
      <span className="flex items-center gap-2">
        <span className="break-all font-mono text-sm">{value}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy confirmation number"
          className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </span>
    </div>
  );
}

function TimeColumn({ d, tripZone }) {
  if (!d.start) return <span className="text-xs text-muted-foreground">—</span>;
  const showZone = d.zone !== tripZone;
  const showEndZone = d.end && d.endZone && d.endZone !== d.zone;
  return (
    <span className="flex flex-col text-xs leading-tight">
      <span className="font-medium text-foreground">{formatTime(d.start)}</span>
      {showZone && <span className="text-muted-foreground">{zoneLabel(d.zone)}</span>}
      {d.end && (
        <span className="text-muted-foreground">
          – {formatTime(d.end)}
          {datePart(d.end) > datePart(d.start) && <sup className="ml-0.5">+1</sup>}
        </span>
      )}
      {showEndZone && <span className="text-muted-foreground">{zoneLabel(d.endZone)}</span>}
    </span>
  );
}

/**
 * One timeline row. `actions` (edit/move/delete for an activity) shows at the
 * bottom of the expanded details, which also makes an otherwise bare activity
 * expandable. Markers (stays, travel) never get actions.
 */
export function TimelineEntry({ entry, trip, expanded, onToggle, actions }) {
  const d = describeEntry(entry, trip);
  const Icon = d.icon;
  const hasDetails = Boolean(
    actions || d.notes || d.confirmation || d.locations.length || d.facts.length
  );

  const summary = (
    <>
      <span className="w-[4.5rem] shrink-0 pt-0.5">
        <TimeColumn d={d} tripZone={trip.timezone} />
      </span>
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background",
          entry.kind === "activity" ? "text-primary" : "text-warning",
          d.muted && "text-muted-foreground"
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("break-words text-sm font-medium", d.muted && "font-normal text-muted-foreground")}>
          {d.title}
        </span>
        {d.subtitle && <span className="break-words text-xs text-muted-foreground">{d.subtitle}</span>}
        {d.warning && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {d.warning}
          </span>
        )}
      </span>
      {hasDetails && (
        <ChevronDown
          className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      )}
    </>
  );

  return (
    <li className="relative pb-3 pl-7">
      <RailDot colorClassName={entry.kind === "activity" ? "bg-primary" : "bg-warning"} />
      <Card className="overflow-hidden">
        {hasDetails ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {summary}
          </button>
        ) : (
          <div className="flex items-start gap-3 px-3 py-2.5">{summary}</div>
        )}

        {hasDetails && expanded && (
          <div className="flex flex-col gap-3 border-t border-border px-3 pb-3 pt-3 sm:pl-[8.25rem]">
            {d.notes && <Markdown className="text-muted-foreground">{d.notes}</Markdown>}
            {d.facts.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {d.facts.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {d.locations.map(({ label, loc }) => (
              <LocationBlock key={label} label={label} loc={loc} />
            ))}
            {d.confirmation && <ConfirmationNumber value={d.confirmation} />}
            {actions}
          </div>
        )}
      </Card>
    </li>
  );
}
