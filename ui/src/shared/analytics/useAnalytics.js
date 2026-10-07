import { useCallback, useEffect, useRef } from "react";
import { useSelector, useStore } from "react-redux";
import { useLocation } from "react-router-dom";
import { getClientConfig } from "@/shared/services/clientConfig";
import { pageFor } from "@/shared/analytics/pages";
import {
  awaitAnalytics,
  forgetAnalytics,
  holdAnalytics,
  rememberedSettings,
  setAnalytics,
  trackEvent,
  trackPageView,
} from "@/shared/analytics/umami";
import { userIdFromToken } from "@/shared/utils/authToken";
import { selectSavedOnly } from "@/shared/networkSlice";

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
 * Decides whether the signed-in person is counted, and where to: their
 * switch (`analytics_enabled` on /users/me) and the Umami address
 * (/config). Opened offline, neither loads, so the last answer remembered
 * on the phone stands in. A switch turned off forgets theirs, queue and all.
 */
export function useAnalyticsSetup() {
  // "Use saved copies only": events keep queueing on the phone, none sent.
  const savedOnly = useSelector(selectSavedOnly);
  useEffect(() => {
    holdAnalytics(savedOnly);
  }, [savedOnly]);

  const userId = useSelector((s) => userIdFromToken(s.auth.token));
  const user = useSelector((s) => s.auth.user);
  const known = user && user.id === userId ? Boolean(user.analytics_enabled) : null; // null: not heard yet

  useEffect(() => {
    if (!userId) {
      setAnalytics(null);
      return undefined;
    }
    if (known === false) {
      forgetAnalytics(userId);
      return undefined;
    }
    const remembered = rememberedSettings(userId);
    if (remembered) setAnalytics(remembered, userId);
    else awaitAnalytics(userId);
    if (known === null) return undefined;
    let live = true;
    getClientConfig()
      .then((config) => {
        if (!live) return;
        if (config?.umamiUrl && config?.umamiWebsiteId) setAnalytics(config, userId);
        else forgetAnalytics(userId); // the server sends nothing anywhere
      })
      .catch(() => {
        // Offline: the remembered answer (if any) already stands.
        if (live && !remembered) setAnalytics(null);
      });
    return () => {
      live = false;
    };
  }, [userId, known]);
}

/**
 * A page view on every route change (swipes between days and entries too),
 * once the page has settled and, inside a trip, once the trip (and so the
 * role) is known — offline too, from the trip saved on the phone. Each
 * navigation counts once.
 */
export function usePageViews() {
  const location = useLocation();
  const page = pageFor(location.pathname);
  const url = page?.url;
  const title = page?.title;
  const role = useSelector((s) => (page ? roleOn(s, page.tripId) : null));

  useEffect(() => {
    // Whether it's sent at all is umami.js's call (the person's switch).
    if (!url || !role) return undefined;
    const timer = setTimeout(() => trackPageView({ url, title, role }), SETTLE_MS);
    return () => clearTimeout(timer);
    // location.key: the same page reached again is another view (and the
    // path, for a history entry made outside the router, which has no key).
  }, [location.key, location.pathname, role, url, title]);
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

/**
 * `name` once per visit to the page, as soon as `ready` (a tool showing
 * what it's for: a forecast, the clocks, a converted amount).
 */
export function useTrackOnce(name, ready, data = {}) {
  const { pathname } = useLocation();
  const page = pageFor(pathname);
  const url = page?.url;
  const role = useSelector((s) => roleOn(s, page?.tripId ?? null));
  const done = useRef(false);
  const details = JSON.stringify(data);
  useEffect(() => {
    if (!ready || !role || done.current) return;
    done.current = true;
    trackEvent(name, { url, role, ...JSON.parse(details) });
  }, [ready, role, name, url, details]);
}
