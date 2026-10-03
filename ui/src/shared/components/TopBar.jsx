import { useState } from "react";
import { Menu } from "lucide-react";
import { NavDrawer } from "@/shared/components/NavDrawer";

/** ☰ (the nav drawer), a title, and room on the right for page actions. */
export function TopBar({ title, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        className="rounded-md p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      {children}
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
