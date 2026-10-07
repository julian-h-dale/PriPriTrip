# Run stage 19 — analytics that survive being offline

Asked 2026-10-07 (Julian), after Run stage 18: count what's done offline
too. He took the recommendation (our own sender with a queue) and said to
go ahead; Umami is **3.4.0**.

## Where we are

- Umami's `script.js` is loaded from the Umami host. Opened offline, it
  doesn't load (the service worker doesn't cache another origin), and a
  send that fails is dropped. So nothing done offline is counted.
- Whether someone is counted comes from `/users/me` (`analytics_enabled`)
  and `/config` (the Umami address). Opened offline, neither loads, so the
  app can't even decide.

## Checked against Umami 3.4.0's source (`src/app/api/send/route.ts`)

- `payload.timestamp` (seconds) is accepted and becomes the event's time
  (`createdAt`), so a queued event lands at the time it happened. The visit
  is the hour it happened in.
- `payload.data` is kept for page views as well as events.
- The `x-umami-cache` header would put a late event in the *current*
  visit, so we never send it. Without it the server works the session out
  itself (from IP and browser, as before).
- Location still comes from the connection that sends: done offline in Bern,
  sent from Chicago, it shows as the US. Accepted.

## Design

- **No Umami script any more.** `shared/analytics/umami.js` posts to
  `<UMAMI_URL>/api/send` itself: the same fields the tracker sends
  (website, hostname, screen, language, url, title, referrer, tag, name,
  data), plus `timestamp`.
- **Every event goes into a queue first** (IndexedDB, `pripritrip-
  analytics`, keyed by user), then the queue is sent oldest first:
  - straight away when online;
  - when the connection comes back, and when the app comes back to the
    front;
  - a server answer (even a refusal) takes the event off the queue; no
    answer, or a 5xx, leaves it there and stops until the next try.
  - Capped at 500 events and 30 days; the oldest go first.
- **Deciding offline:** the switch and the Umami address are remembered on
  the phone per user (`localStorage`, like the saved trips) once the
  server has said, so an app opened offline still counts. Before anything is
  known, up to 20 events wait in memory, then are queued or dropped.
- **Turned off, or signed out:** an admin turning someone's switch off
  drops their queue (on the next load that hears it), and so does signing
  out.
- Referrer: only an outside one, and only on the first page view of an app
  load.

## Phases

- **Phase 79 — the sender and its queue.**
  - **Tests:** queued then sent with the time it happened; kept while
    offline, sent oldest first when back; a refusal is dropped, a 5xx kept;
    caps; turned off or signed out drops the queue; an app opened offline
    uses the remembered switch.
  - **E2E:** online, events arrive; offline, navigating sends nothing;
    back online, they arrive with their earlier times.

## Built

- **Phase 79 ✅ (2026-10-07):** as designed. `make verify` green (277 API
  + 505 UI); e2e `analytics.spec.js` (5 tests, one offline round trip).

## Open questions

None: Julian took the recommendation (2026-10-07).
