import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/utils/cn";

/**
 * Modal dialog — hand-rolled in the shadcn *shape* like the other primitives
 * here (see quickstart_technical.md), not Radix-backed.
 *
 * Escape and a backdrop click close it; focus moves into the panel on open and
 * returns to the opener on close.
 */
export function Dialog({ open, onClose, title, description, children, className }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  // Callers pass inline `onClose` functions, a new one every render. Reading
  // it through a ref keeps the effect below tied to open/close only —
  // otherwise every keystroke in a form re-ran it and yanked focus away.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
          className
        )}
      >
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
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DialogFooter({ className, ...props }) {
  return <div className={cn("flex justify-end gap-2", className)} {...props} />;
}
