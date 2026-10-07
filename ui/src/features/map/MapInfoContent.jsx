import { useState } from "react";
import { Link } from "react-router-dom";
import { entryPath } from "@/features/entry/entries";
import { ACTION_LABEL, placeActions } from "@/features/map/placeActions";
import { directionsUrl } from "@/features/map/mapStyle";
import { formatDayHeading } from "@/shared/utils/time";

// The InfoWindow's own chrome is always a plain white card, whatever this
// app's dark theme: this content is portaled into Google's popup, but still
// sits in our document, so <body>'s near-white `color` would cascade into it.
// Every color here is explicit so it reads on white.
const TEXT = "text-[#202124]";
const MUTED = "text-[#5f6368]";
const LINK = "text-[13px] text-[#1a73e8] hover:underline";

function Photo({ src }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img src={src} alt="" className="mb-1.5 block h-24 w-full rounded-md object-cover" onError={() => setFailed(true)} />
  );
}

/** A trip marker: photo, title, its day, then links: its own page, the
 * day's page, directions. */
function TripMarkerInfo({ marker, tripId }) {
  return (
    <>
      <Photo src={marker.imgRef} />
      <div className={`mb-0.5 font-semibold ${TEXT}`}>{marker.title}</div>
      <div className={`mb-1.5 text-xs ${MUTED}`}>{formatDayHeading(marker.day)}</div>
      {marker.entryId && (
        <Link to={entryPath(tripId, marker.kind, marker.entryId)} className={`mb-0.5 block ${LINK}`}>
          Details
        </Link>
      )}
      <Link to={`/trips/${tripId}/days/${marker.day}`} className={`mb-0.5 block ${LINK}`}>
        View day
      </Link>
      <a href={directionsUrl(marker)} target="_blank" rel="noopener noreferrer" className={`block ${LINK}`}>
        Directions
      </a>
    </>
  );
}

function ActionButton({ action, onAction, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onAction(action)}
      disabled={disabled}
      className="rounded-[4px] border border-[#1a73e8] px-2 py-1 text-[13px] font-medium text-[#1a73e8] hover:bg-[#e8f0fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] disabled:opacity-50"
    >
      {ACTION_LABEL[action]}
    </button>
  );
}

/**
 * A place found through Google search, not on the trip yet: photo, name,
 * address, a "Not in this trip" label, then the Add actions that fit the
 * place (`placeActions`), with the rest behind "More…".
 */
function NewPlaceInfo({ place, types, onAction, readOnly, canAdd }) {
  const [showMore, setShowMore] = useState(false);
  const { primary, more } = placeActions(types);
  const actions = showMore ? [...primary, ...more] : primary;
  return (
    <>
      <Photo src={place.imgRef} />
      <div className={`font-semibold ${TEXT}`}>{place.name}</div>
      {place.address && <div className={`text-xs ${MUTED}`}>{place.address}</div>}
      <div className="mb-2 mt-1 inline-block rounded-[4px] bg-[#fef7e0] px-1.5 py-0.5 text-[11px] font-medium text-[#8a5a00]">
        Not in this trip
      </div>
      {canAdd && actions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {actions.map((action) => (
            <ActionButton key={action} action={action} onAction={onAction} disabled={readOnly} />
          ))}
          {!showMore && more.length > 0 && (
            <button type="button" onClick={() => setShowMore(true)} className={`px-1 ${LINK}`}>
              More…
            </button>
          )}
        </div>
      )}
      <a href={directionsUrl(place)} target="_blank" rel="noopener noreferrer" className={`block ${LINK}`}>
        Directions
      </a>
    </>
  );
}

/** A journal memory: its words, when and by whom, and a way to the journal. */
function MemoryInfo({ marker, tripId }) {
  return (
    <>
      <p className={`mb-1 line-clamp-6 whitespace-pre-wrap break-words ${TEXT}`}>{marker.text}</p>
      <div className={`mb-1.5 text-xs ${MUTED}`}>
        {formatDayHeading(marker.day)} · {marker.time} · {marker.author}
      </div>
      <Link to={`/trips/${tripId}/journal`} className={`mb-0.5 block ${LINK}`}>
        Open journal
      </Link>
      <a href={directionsUrl(marker)} target="_blank" rel="noopener noreferrer" className={`block ${LINK}`}>
        Directions
      </a>
    </>
  );
}

/**
 * What the map's InfoWindow shows, rendered by React (portaled into the
 * popup) so its buttons and links are ordinary React handlers.
 *
 * `info`: { kind: "trip", marker } | { kind: "place", place, types }
 */
export function MapInfoContent({ info, tripId, onAction, readOnly, canAdd = true }) {
  return (
    <div className="max-w-[220px] text-sm">
      {info.kind === "trip" && info.marker.kind === "memory" ? (
        <MemoryInfo marker={info.marker} tripId={tripId} />
      ) : info.kind === "trip" ? (
        <TripMarkerInfo marker={info.marker} tripId={tripId} />
      ) : (
        // key: a different place starts with "More…" collapsed again.
        <NewPlaceInfo
          key={info.place.placeId}
          place={info.place}
          types={info.types}
          onAction={onAction}
          readOnly={readOnly}
          canAdd={canAdd}
        />
      )}
    </div>
  );
}
