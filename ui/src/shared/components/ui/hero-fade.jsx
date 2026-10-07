import { cn } from "@/shared/utils/cn";

/**
 * The "hero fade": a photo at the top of a card or page that fades into it,
 * so the content below always sits on a solid colour. An entry's page uses
 * it (fadeTo="background"), so a stay, leg or activity opens on its place.
 *
 * Decorative only (alt=""). Pair it with `useHeroImage` (shared/utils), which
 * drops the photo if it can't load. A deliberate, opt-in departure from
 * design_doc.md's "no gradients" — see ui_review.md.
 */

const FADE = {
  card: "from-card/0 via-card/70 to-card",
  background: "from-background/0 via-background/70 to-background",
};

/** Absolutely positioned at the top of a `relative` parent; clear at the top,
 * solid by the bottom: the card's colour, or `fadeTo="background"` on a page. */
export function HeroFade({ src, onError, className, fadeTo = "card" }) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 top-0", className)} aria-hidden="true">
      <img
        src={src}
        alt=""
        data-testid="hero-fade"
        className="h-full w-full object-cover"
        onError={onError}
      />
      <div className={cn("absolute inset-0 bg-gradient-to-b", FADE[fadeTo])} />
    </div>
  );
}
