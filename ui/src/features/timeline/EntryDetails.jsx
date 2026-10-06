import { useState } from "react";
import { Check, Copy, ExternalLink, MapPin } from "lucide-react";
import { Markdown } from "@/shared/components/Markdown";
import { mapsUrl } from "@/shared/utils/mapsLinks";
import { formatAgo } from "@/shared/utils/time";

/** A confirmation number, with a copy button. `large` on an entry's page,
 * where it's the first thing shown (it's what a desk asks for). */
export function ConfirmationNumber({ value, large = false }) {
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
        <span className={large ? "break-all font-mono text-2xl font-semibold tracking-wide" : "break-all font-mono text-sm"}>
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy confirmation number"
          className="rounded-sm p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </span>
    </div>
  );
}

/**
 * One place: label, name, address, then its links (open in the maps app,
 * website). Its photo is the entry's hero (hero-fade.jsx), not shown here.
 */
export function PlaceRow({ label, loc }) {
  const map = mapsUrl(loc);
  return (
    <div className="flex gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="break-words text-sm">{loc.name}</span>
        {loc.address && <span className="break-words text-xs text-muted-foreground">{loc.address}</span>}
        {(map || loc.url) && (
          <span className="flex flex-wrap gap-x-4 text-sm">
            {map && (
              <a
                href={map}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 text-primary underline-offset-2 hover:underline"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Open map
              </a>
            )}
            {loc.url && (
              <a
                href={loc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 text-primary underline-offset-2 hover:underline"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Website
              </a>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The details of one stay, leg or activity, in the order you look for them:
 * the booking facts and confirmation number first, then notes, then places
 * (its photo is the hero behind them). Shared by the day page's
 * expanded entries, the stays/travel quick look and the Today tab, so it
 * reads the same everywhere.
 *
 * `d` is describeEntry()'s output (facts, confirmation, notes, locations,
 * hero photo, and who last edited it).
 */
export function EntryDetails({ d }) {
  return (
    <div className="flex flex-col gap-3">
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
      {d.confirmation && <ConfirmationNumber value={d.confirmation} />}
      {d.notes && <Markdown className="text-muted-foreground">{d.notes}</Markdown>}
      {d.locations.map(({ label, loc }) => (
        <PlaceRow key={label} label={label} loc={loc} />
      ))}
      {d.edited && <EditedBy edited={d.edited} />}
    </div>
  );
}

/** "Edited by PriPri, 2 minutes ago". Its own component so it's easy to hide
 * later (Julian may, before the trip). */
export function EditedBy({ edited }) {
  return (
    <p className="text-xs text-muted-foreground">
      Edited by {edited.name}, {formatAgo(edited.at)}
    </p>
  );
}
