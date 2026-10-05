import { cn } from "@/shared/utils/cn";

/**
 * The "hero fade": a photo at the top of a card that fades into it, so the
 * content below always sits on solid card. Shared by the details dialog and
 * the expanded timeline rows, so a stay, leg or activity looks the same in both.
 *
 * Decorative only (alt=""). Pair it with `useHeroImage` (shared/utils), which
 * drops the photo if it can't load. A deliberate, opt-in departure from
 * design_doc.md's "no gradients" — see ui_review.md.
 */

/** Absolutely positioned at the top of a `relative` parent; clear at the top,
 * solid card by the bottom. */
export function HeroFade({ src, onError, className }) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 top-0", className)} aria-hidden="true">
      <img
        src={src}
        alt=""
        data-testid="hero-fade"
        className="h-full w-full object-cover"
        onError={onError}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-card/0 via-card/70 to-card" />
    </div>
  );
}
