/**
 * Usage analytics to Umami (Run stage 18): the one place that talks to its
 * tracker. Nothing loads, and every call is a no-op, unless the signed-in
 * person's switch is on (`analytics_enabled`, set on the Admin page) and the
 * server gave an Umami address and website id (GET /config).
 *
 * The tracker's own page tracking is off (`data-auto-track="false"`): it
 * would send real addresses, trip and entry ids and all. We send the page's
 * name instead (pages.js), with the person's role on the trip as the tag and
 * as event data, so Umami can split any count by owner / editor / viewer.
 *
 * Failures are silent: an ad blocker, no connection or Umami being down never
 * toasts and never breaks a page. What happens offline isn't counted.
 */

let enabled = false;
let script = null; // the <script> once added (it can't be taken out again)
let ready = false;
let queue = []; // calls made before the tracker loaded

// Enough for the first screens of a visit; a tracker that never loads (an ad
// blocker) mustn't grow it forever.
const MAX_QUEUED = 20;

function tracker() {
  return typeof window !== "undefined" && window.umami && typeof window.umami.track === "function"
    ? window.umami
    : null;
}

/** Turn sending on (loading the tracker the first time) or off. */
export function setAnalytics(config) {
  enabled = Boolean(config?.umamiUrl && config?.umamiWebsiteId);
  if (!enabled) {
    queue = [];
    return;
  }
  if (script) return;
  script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.src = `${config.umamiUrl}/script.js`;
  script.dataset.websiteId = config.umamiWebsiteId;
  script.dataset.hostUrl = config.umamiUrl;
  script.dataset.autoTrack = "false";
  script.addEventListener("load", () => {
    ready = true;
    const waiting = queue;
    queue = [];
    waiting.forEach(send);
  });
  script.addEventListener("error", () => {
    queue = [];
  });
  document.head.appendChild(script);
}

function send(payload) {
  if (!enabled) return;
  const umami = tracker();
  if (!ready || !umami) {
    if (queue.length < MAX_QUEUED) queue.push(payload);
    return;
  }
  try {
    umami.track((props) => ({
      ...props,
      ...payload,
      // Ours, not the document's: never the trip's name, never an id. A
      // referrer from inside the app (a path, ids and all) is dropped too.
      referrer: props.referrer?.startsWith("/") ? "" : props.referrer,
    }));
  } catch {
    // Analytics never breaks the app.
  }
}

/** A page view: `url` and `title` are the page's name (pages.js), never its address. */
export function trackPageView({ url, title, role }) {
  send({ url, title, tag: role, data: { role } });
}

/** A named event (a Trip tool used), with the role and any details. */
export function trackEvent(name, { url, role, ...data } = {}) {
  send({ name, url, tag: role, data: { role, ...data } });
}

/** For tests: forget the tracker and anything queued. */
export function resetAnalyticsForTests() {
  enabled = false;
  script?.remove();
  script = null;
  ready = false;
  queue = [];
}
