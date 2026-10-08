import { matchPath } from "react-router-dom";

/**
 * Each route as Umami sees it: a page's name, never its real address, so no
 * trip or entry id leaves the app and every trip's Map counts as one page.
 * Routes not listed (sign-in, the "/" redirect) aren't sent at all.
 */
const PAGES = [
  { path: "/trips", url: "/trips", title: "All trips" },
  { path: "/trips/:tripId", url: "/trip/timeline", title: "Timeline" },
  { path: "/trips/:tripId/today", url: "/trip/today", title: "Today" },
  { path: "/trips/:tripId/journal", url: "/trip/journal", title: "Journal" },
  { path: "/trips/:tripId/days/:date", url: "/trip/day", title: "Day" },
  { path: "/trips/:tripId/activities/:id", url: "/trip/activity", title: "Activity" },
  { path: "/trips/:tripId/stays/:id", url: "/trip/stay", title: "Stay" },
  { path: "/trips/:tripId/travel/:id", url: "/trip/travel", title: "Travel" },
  { path: "/trips/:tripId/map", url: "/trip/map", title: "Map" },
  { path: "/trips/:tripId/weather", url: "/trip/weather", title: "Weather" },
  { path: "/trips/:tripId/currency", url: "/trip/currency", title: "Currency" },
  { path: "/trips/:tripId/time", url: "/trip/timezones", title: "Time zones" },
  { path: "/trips/:tripId/packing", url: "/trip/packing", title: "Packing" },
  { path: "/trips/:tripId/documents", url: "/trip/documents", title: "Documents" },
  { path: "/admin", url: "/admin", title: "Admin" },
];

/** `{ url, title, tripId }` for a pathname, or null when it isn't counted. */
export function pageFor(pathname) {
  for (const page of PAGES) {
    const match = matchPath({ path: page.path, end: true }, pathname);
    if (match) return { url: page.url, title: page.title, tripId: match.params.tripId ?? null };
  }
  return null;
}

/** The timeline's Stays or Travel view, counted as its own page. */
export function timelineViewPage(view) {
  const title = view === "stays" ? "Timeline: Stays" : "Timeline: Travel";
  return { url: `/trip/timeline/${view}`, title };
}
