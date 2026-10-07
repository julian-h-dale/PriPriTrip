import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import { NavDrawer } from "@/shared/components/NavDrawer";

const ICON_BUTTON =
  "rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * ☰ (the nav drawer), a title, and room on the right for page actions.
 *
 * `back` (a path): a page reached from the drawer gets ← in ☰'s place
 * instead. It goes back to the screen you came from, or to `back` when the
 * page was opened directly (a reload, a shared link). `backHistory={false}`:
 * always to `back` (an entry's page, where Previous / Next replace history).
 */
export function TopBar({ title, back, backHistory = true, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // React Router keys the first entry "default": nothing in the app to go back to.
  const goBack = () => (!backHistory || location.key === "default" ? navigate(back) : navigate(-1));
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
      {back ? (
        <button type="button" onClick={goBack} aria-label="Back" className={ICON_BUTTON}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className={ICON_BUTTON}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      {children}
      {!back && <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />}
    </header>
  );
}
