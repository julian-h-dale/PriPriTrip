import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/utils/cn";

/**
 * Modal dialog — hand-rolled in the shadcn *shape* like the other primitives
 * here (see quickstart_technical.md), not Radix-backed.
 *
 * Escape and a backdrop click close it; focus moves into the panel on open and
 * returns to the opener on close.
 *
 * `heroImage` (optional): a photo shown at the top of the panel, fading into
 * the card behind the title — the "hero fade". Decorative only (alt=""), and
 * the content always sits on solid card. Without one, or if it fails to load
 * (e.g. offline: photos aren't cached), it's the plain dialog. A deliberate,
 * opt-in departure from design_doc.md's "no gradients" — see ui_review.md.
 */
export function Dialog({ open, onClose, title, description, children, className, heroImage }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  // Callers pass inline `onClose` functions, a new one every render. Reading
  // it through a ref keeps the effect below tied to open/close only —
  // otherwise every keystroke in a form re-ran it and yanked focus away.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [heroFailed, setHeroFailed] = useState(false);
  useEffect(() => setHeroFailed(false), [heroImage]);
  const hero = heroImage && !heroFailed ? heroImage : null;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    panelRef.current?.focus();
    function onKeyDown(e) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/70" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[85vh] w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground focus:outline-none",
          hero && "overflow-hidden pt-32",
          className
        )}
      >
        {hero && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48" aria-hidden="true">
            <img
              src={hero}
              alt=""
              data-testid="dialog-hero"
              className="h-full w-full object-cover"
              onError={() => setHeroFailed(true)}
            />
            {/* Clear at the top, solid card by the time the title's text ends. */}
            <div className="absolute inset-0 bg-gradient-to-b from-card/0 via-card/70 to-card" />
          </div>
        )}
        <div className="relative flex flex-col gap-1">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {hero ? <div className="relative flex min-h-0 flex-col gap-4">{children}</div> : children}
      </div>
    </div>,
    document.body
  );
}

export function DialogFooter({ className, ...props }) {
  return <div className={cn("flex justify-end gap-2", className)} {...props} />;
}
