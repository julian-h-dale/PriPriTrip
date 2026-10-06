import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/shared/utils/cn";

const GAP = 4; // px between the button and the menu
const MARGIN = 8; // px the menu keeps from the screen's edges

/**
 * A "⋯" button with a small menu, for actions that shouldn't sit right next
 * to a row's main tap target (e.g. delete). `items`: [{ label, onSelect,
 * destructive?, disabled? }]. Escape, a click elsewhere or scrolling closes it.
 *
 * The menu is portaled to <body> and positioned against the button, so a row
 * that clips its contents (a rounded card, the day swiper) can't cut it off.
 * It opens below the button, or above it when there isn't room below.
 */
export function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null); // { top, right } in viewport px
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      if (!buttonRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    // Positioned against the screen, so it would drift if the page moved under it.
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Place the menu once it's rendered (its height decides below or above).
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPlace(null);
      return;
    }
    const button = buttonRef.current.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = button.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    setPlace({
      top: fitsBelow ? below : Math.max(MARGIN, button.top - GAP - height),
      right: Math.max(MARGIN, window.innerWidth - button.right),
    });
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            style={place ?? { top: 0, right: 0, visibility: "hidden" }}
            className="fixed z-50 min-w-36 rounded-md border border-border bg-card py-1"
          >
            {items.map((item) => (
              <li key={item.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50",
                    item.destructive && "text-destructive"
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}
