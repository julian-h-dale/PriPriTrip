import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CloudUpload, Eye, Images } from "lucide-react";
import { usePhotoSrc } from "@/features/journal/photoUrls";
import { cn } from "@/shared/utils/cn";

/** A small dark chip in a corner of the photo; readable on any photo. */
function PhotoBadge({ icon: Icon, label, children, className }) {
  return (
    <span
      title={label}
      className={cn("inline-flex items-center gap-1 rounded-sm bg-black/60 px-1.5 py-0.5 text-xs text-white", className)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The marks a memory can carry, as badges: count, sync state, public. */
function Badges({ memory, showPublic, onPhoto }) {
  const photos = memory.photos ?? [];
  const stuck = memory.stuck || photos.some((p) => p.stuck);
  const tone = onPhoto ? "" : "bg-muted text-foreground";
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {photos.length > 1 && (
        <PhotoBadge icon={Images} label={`${photos.length} photos`} className={tone}>
          {photos.length}
        </PhotoBadge>
      )}
      {stuck ? (
        <PhotoBadge icon={AlertTriangle} label="Couldn’t upload" className="bg-destructive text-destructive-foreground" />
      ) : memory.pending ? (
        <PhotoBadge icon={CloudUpload} label="Waiting to sync" className={tone} />
      ) : (
        photos.some((p) => p.pending) && <PhotoBadge icon={CloudUpload} label="Waiting to upload" className={tone} />
      )}
      {showPublic && <PhotoBadge icon={Eye} label="Public" className={tone} />}
    </span>
  );
}

/**
 * One memory in the journal: mostly its first photo, with the start of its
 * words over a dark fade at the bottom (dark in light mode too: it sits on a
 * photo, not on the page). No photo — or one this phone can't show (offline,
 * saved copies only) — and it's the words on a faint tint of the author's
 * color. The left edge is the author's color. Tapping opens the memory.
 *
 * The thumbnail (480 px) is plenty for a phone-wide tile and is the copy the
 * phone keeps for offline; the full view loads the display copy.
 */
export function MemoryTile({ memory, to, style, showPublic, onOpen }) {
  const first = memory.photos?.[0];
  const src = usePhotoSrc(first?.thumbUrl ?? first?.displayUrl);
  const [failed, setFailed] = useState(false);
  const photo = Boolean(src) && !failed;
  const author = style.label;

  return (
    <Link
      to={to}
      onClick={onOpen}
      className={cn(
        "block overflow-hidden rounded-md border border-l-[3px] border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        style.edge
      )}
    >
      {photo ? (
        <span className="relative block aspect-[4/3] bg-muted">
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
          <span className="absolute right-2 top-2">
            <Badges memory={memory} showPublic={showPublic} onPhoto />
          </span>
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-3 pb-2.5 pt-10">
            <span className="line-clamp-2 whitespace-pre-line break-words text-sm text-white">{memory.text}</span>
            <span className="sr-only"> · {author}</span>
          </span>
        </span>
      ) : (
        <span className={cn("flex items-start gap-2 p-3", style.tint)}>
          <span className="line-clamp-4 min-w-0 flex-1 whitespace-pre-line break-words text-sm">{memory.text}</span>
          <span className="sr-only"> · {author}</span>
          <Badges memory={memory} showPublic={showPublic} />
        </span>
      )}
    </Link>
  );
}
