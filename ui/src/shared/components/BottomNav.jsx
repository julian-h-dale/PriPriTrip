import { Link, useLocation } from "react-router-dom";
import { List, MapPin } from "lucide-react";
import { cn } from "@/shared/utils/cn";

const TABS = [
  {
    to: (tripId) => `/trips/${tripId}`,
    icon: List,
    label: "Timeline",
    active: (path, tripId) => path === `/trips/${tripId}` || path.startsWith(`/trips/${tripId}/days`),
  },
  {
    to: (tripId) => `/trips/${tripId}/map`,
    icon: MapPin,
    label: "Map",
    active: (path, tripId) => path === `/trips/${tripId}/map`,
  },
];

/** The Timeline/Map tab bar shown only while viewing one trip. */
export function BottomNav({ tripId }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Trip" className="flex shrink-0 border-t border-border bg-card">
      {TABS.map(({ to, icon: Icon, label, active }) => {
        const isActive = active(pathname, tripId);
        return (
          <Link
            key={label}
            to={to(tripId)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
