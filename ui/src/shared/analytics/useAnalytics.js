import { useCallback, useEffect } from "react";
import { useSelector, useStore } from "react-redux";
import { useLocation } from "react-router-dom";
import { getClientConfig } from "@/shared/services/clientConfig";
import { pageFor } from "@/shared/analytics/pages";
import { setAnalytics, trackEvent, trackPageView } from "@/shared/analytics/umami";

// Like Umami's own tracker: a page counts once it has been on screen this
// long, so a redirect (a viewer sent from Today to the timeline) counts
// only where it lands.
const SETTLE_MS = 300;

/** The signed-in person's role on the trip on screen, or "none" outside one. */
function roleOn(state, tripId) {
  if (!tripId) return "none";
  const trip = state.timeline?.trip;
  return trip && trip.id === tripId ? trip.role : null; // null: not loaded yet
}

/**
 * Turns analytics on while the signed-in person's switch is on and the
 * server has an Umami address, and off otherwise (signed out included).
 */
export function useAnalyticsSetup() {
  const on = useSelector((s) => Boolean(s.auth.token && s.auth.user?.analytics_enabled));
  useEffect(() => {
    if (!on) {
      setAnalytics(null);
      return undefined;
    }
    let live = true;
    getClientConfig()
      .then((config) => live && setAnalytics(config))
      .catch(() => {}); // offline, say: try again on the next load
    return () => {
      live = false;
    };
  }, [on]);
}

/**
 * A page view on every route change (swipes between days and entries too),
 * once the page has settled and, inside a trip, once the trip (and so the
 * role) is known. Each navigation counts once.
 */
export function usePageViews() {
  const location = useLocation();
  const page = pageFor(location.pathname);
  const url = page?.url;
  const title = page?.title;
  const on = useSelector((s) => Boolean(s.auth.user?.analytics_enabled));
  const role = useSelector((s) => (page ? roleOn(s, page.tripId) : null));

  useEffect(() => {
    if (!on || !url || !role) return undefined;
    const timer = setTimeout(() => trackPageView({ url, title, role }), SETTLE_MS);
    return () => clearTimeout(timer);
    // location.key: the same page reached again is another view (and the
    // path, for a history entry made outside the router, which has no key).
  }, [location.key, location.pathname, on, role, url, title]);
}

/** The role on the trip of the page on screen, read when it's needed. */
function useCurrentRole() {
  const store = useStore();
  const { pathname } = useLocation();
  return useCallback(() => {
    const page = pageFor(pathname);
    return { page, role: roleOn(store.getState(), page?.tripId ?? null) };
  }, [store, pathname]);
}

/**
 * `track(name, data)` for a named event on the page on screen, with the
 * role on its trip. Safe to call whether analytics is on or not.
 */
export function useTrack() {
  const current = useCurrentRole();
  return useCallback(
    (name, data = {}) => {
      const { page, role } = current();
      if (role) trackEvent(name, { url: page?.url, role, ...data });
    },
    [current],
  );
}

/** `trackView({ url, title })`: a view within a page (the timeline's Stays). */
export function useTrackView() {
  const current = useCurrentRole();
  return useCallback(
    (view) => {
      const { role } = current();
      if (role) trackPageView({ ...view, role });
    },
    [current],
  );
}
