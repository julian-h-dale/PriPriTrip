import { useState } from "react";
import { AlertTriangle, CloudUpload, ImageOff } from "lucide-react";
import { PhotoViewer } from "@/features/journal/PhotoViewer";
import { usePhotoSrc } from "@/features/journal/photoUrls";

function Thumb({ photo, onOpen, label }) {
  const [failed, setFailed] = useState(false);
  const src = usePhotoSrc(photo.thumbUrl);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        // Offline (or saved copies only) and never seen: no saved thumbnail.
        <ImageOff className="m-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
      )}
      {photo.stuck ? (
        <span className="absolute bottom-1 right-1 rounded-sm bg-destructive p-0.5" title="Couldn’t upload">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive-foreground" aria-hidden="true" />
        </span>
      ) : (
        photo.pending && (
          <span className="absolute bottom-1 right-1 rounded-sm bg-black/60 p-0.5" title="Waiting to upload">
            <CloudUpload className="h-3.5 w-3.5 text-white" aria-hidden="true" />
          </span>
        )
      )}
    </button>
  );
}

/**
 * A memory's photos as a row of thumbnails; tapping one opens the viewer.
 * `onRetry` / `onRemove` act on a photo the server refused (stuck).
 */
export function PhotoStrip({ photos, onRetry, onRemove }) {
  const [open, setOpen] = useState(null);
  if (!photos?.length) return null;
  return (
    <>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Photos">
        {photos.map((photo, i) => (
          <Thumb
            key={photo.id}
            photo={photo}
            onOpen={() => setOpen(i)}
            label={`Photo ${i + 1} of ${photos.length}${photo.stuck ? ", couldn’t upload" : ""}`}
          />
        ))}
      </div>
      {open !== null && (
        <PhotoViewer photos={photos} start={open} onClose={() => setOpen(null)} onRetry={onRetry} onRemove={onRemove} />
      )}
    </>
  );
}
