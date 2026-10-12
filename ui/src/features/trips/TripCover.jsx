import { usePhotoSrc } from "@/features/journal/photoUrls";
import { cn } from "@/shared/utils/cn";

/**
 * A trip's cover: its emoji, or its photo's thumbnail, in a small square
 * tile. Offline, a photo the phone hasn't kept shows as an empty tile.
 */
export function TripCover({ trip, className }) {
  const src = usePhotoSrc(trip.coverThumbUrl ?? null);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary text-2xl leading-none",
        className
      )}
    >
      {trip.coverThumbUrl ? (
        src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        trip.coverEmoji
      )}
    </span>
  );
}
