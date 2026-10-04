import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { ChevronLeft, ChevronRight, Download, Maximize2, Save, X } from "lucide-react";
import { photoSrc } from "@/features/journal/photoUrls";
import { saveToPhone } from "@/features/journal/saveToPhone";
import { notify } from "@/shared/notificationSlice";
import { pendingPhotoFile } from "@/shared/services/outbox";
import { userIdFromToken } from "@/shared/utils/authToken";

const SWIPE_MIN_PX = 60;

/**
 * Full-screen photos: the display copy (fast), swipe or arrows between them,
 * "Full quality" to load the original — then pinch-zoom as on any page —
 * and "Download original". A photo still waiting to upload has "Save to
 * phone" instead: one taken in the app isn't in the camera roll.
 */
export function PhotoViewer({ photos, start = 0, onClose }) {
  const dispatch = useDispatch();
  const userId = useSelector((s) => userIdFromToken(s.auth?.token));
  const [index, setIndex] = useState(start);
  const [full, setFull] = useState(false);
  const touch = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const photo = photos[index];
  const go = (delta) => {
    setIndex((i) => Math.min(photos.length - 1, Math.max(0, i + delta)));
    setFull(false);
  };

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go only reads setters
  }, []);

  // A waiting photo's file is read ahead, so the tap shares it at once:
  // iOS only opens the share sheet straight after a tap.
  const [file, setFile] = useState(null);
  useEffect(() => {
    setFile(null);
    if (!photo?.pending) return undefined;
    let live = true;
    pendingPhotoFile(userId, photo.id).then((f) => live && setFile(f));
    return () => {
      live = false;
    };
  }, [userId, photo?.id, photo?.pending]);

  async function save() {
    const outcome = await saveToPhone(file);
    if (outcome === "downloaded") dispatch(notify({ type: "success", message: "Photo downloaded" }));
  }

  if (!photo) return null;
  const button =
    "rounded-md bg-black/50 p-2.5 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      className="fixed inset-0 z-50 flex flex-col bg-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null; // not pinch
      }}
      onTouchEnd={(e) => {
        if (!touch.current || full) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touch.current.x;
        const dy = t.clientY - touch.current.y;
        touch.current = null;
        if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-2 p-2 text-sm text-white">
        <button type="button" onClick={onClose} aria-label="Close photos" className={button}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <span aria-live="polite">
          {index + 1} / {photos.length}
        </span>
        <div className="flex gap-2">
          {!photo.pending && !full && (
            <button type="button" onClick={() => setFull(true)} className={button} aria-label="Full quality">
              <Maximize2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {!photo.pending && (
            <a href={photoSrc(photo.originalUrl)} download className={button} aria-label="Download original">
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          {photo.pending && (
            <button
              type="button"
              onClick={save}
              disabled={!file}
              className={`${button} flex items-center gap-1.5 text-sm disabled:opacity-60`}
            >
              <Save className="h-5 w-5" aria-hidden="true" />
              Save to phone
            </button>
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">
        <img
          key={`${photo.id}:${full}`}
          src={photoSrc(full ? photo.originalUrl : photo.displayUrl)}
          alt=""
          className={full ? "max-w-none" : "max-h-full max-w-full object-contain"}
        />
        {index > 0 && (
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`absolute left-2 ${button}`}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {index < photos.length - 1 && (
          <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`absolute right-2 ${button}`}>
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
