# PROGRESS

> Resumable state so a dropped session can pick up where it left off. The agent
> updates this after every phase (and whenever meaningful progress is made).
> Keep it short and current.

## Status

- **Run stage 21 (2026-10-07)** on **`analytics`**: field fixes. Plan:
  `docs/plan/run-21-field-fixes.md`.
  - **Phase 82 ✅:** trips open on Today (active and upcoming; past trips and
    viewers on the timeline); Tonight shows check-out once you're staying.
- **Run stage 20 (2026-10-07)** on **`analytics`**: "Use saved copies only".
  Plan: `docs/plan/run-20-data-saver.md`.
  - **Phase 80 ✅:** the switch (everyone's drawer, remembered per phone);
    `selectOnline` replaces the 18 direct reads; `apiClient` refuses every
    request but sign-in and `/users/me`; no mini maps, place photos,
    Frankfurter or uncached journal photos; memories and analytics wait.
    `make verify` green (277 API + 527 UI); e2e `saved-only.spec.js`.
  - Julian: complete all the outstanding phases (81–86) without stopping.
  - **Phase 81 ✅:** Refresh once on the bar. `make verify` green (277 API
    + 532 UI). **Run stage 20 is complete.**
- **Field review and docs (2026-10-07)** on **`analytics`**:
  - Usability review at 375 px, online and offline:
    `docs/ui-review-2026-10-07.md` (unscheduled; in the backlog).
  - Julian's data-saver idea planned as **Run stage 20**
    (`docs/plan/run-20-data-saver.md`).
  - Review decisions planned as **Run 21** (field fixes) and **Run 22**
    (light mode, text size). Order: 20 → 21 → 22. All questions answered
    (Julian took every recommendation, 2026-10-07).
  - READMEs: the root one is now a map of the parts and how to run each;
    new `api/README.md`, `ui/README.md`, `scripts/pi-backup/README.md`
    (moved from the root); `deploy/README.md` lists every production
    secret and the deploy steps; `ui/e2e/README.md` lists the specs and
    how to source `api/.env` for local seed passwords.
    `api/.env.example` gained `DOCUMENT_DIR`.
- **Run stage 19 ✅ (2026-10-07)** on **`analytics`**: analytics that
  survive being offline. Plan: `docs/plan/run-19-offline-analytics.md`
  (Julian took the recommendation; Umami is 3.4.0, whose `/api/send`
  takes `timestamp`).
  - **Phase 79 ✅:** no Umami script; `shared/analytics/umami.js` posts
    to `/api/send` through a queue in IndexedDB (per user, oldest first,
    500 events / 30 days), sent at once, when back online and when the app
    returns to the front, each with the time it happened. The switch and
    Umami address are remembered on the phone, so an app opened offline
    counts. A switch turned off or signing out drops the queue. `make
    verify` green (277 API + 505 UI); e2e `analytics.spec.js` (5) passes.
  - Not pushed or deployed (nor is Run 18).
- **Run stage 18 (2026-10-07)** on branch **`analytics`** (off `main`
  after PR #16): usage analytics to Julian's Umami. Plan:
  `docs/plan/run-18-analytics.md`; answers in (Q-A3 (b): the switch is set
  when the account is made and only changed by hand; Q-A5: keep `owner`).
  Julian: go through all the planned phases, then report.
  - The seed's replant now deletes points of interest, packing items and
    documents too (`make seed` failed on a database that had them).
  - **Phase 76 ✅:** `users.analytics_enabled` (migration 0014: off for
    admins, on for the rest; new accounts the same), an Analytics On / Off
    column on the Admin page (any row, your own included), `PATCH
    /admin/users/:id` takes `analyticsEnabled`. `UMAMI_URL` and
    `UMAMI_WEBSITE_ID` on `/config` (empty: nothing sent). `make verify`
    green (277 API + 480 UI). Dev database migrated.
  - **Phase 77 ✅:** page views to Umami (`shared/analytics/`): loaded
    only when the person's switch is on and `/config` has Umami; page
    names, never addresses (`/trip/map`); the role on the trip as the tag
    and event data; Stays / Travel views count apart. `make verify` green
    (277 API + 496 UI); e2e `analytics.spec.js` (a pretend Umami serving
    a copy of the real tracker) passes. Run e2e with `set -a; . api/.env`
    for this machine's seed passwords.
  - **Phase 78 ✅:** Trip tools events (`tool-open`, `currency-convert`,
    `weather-view`, `timezones-view`, `packing-check` / `packing-add`,
    `document-upload` / `document-open`, `share-open`), each with the
    role. Weather has no day to tap, so `weather-view` is "a forecast
    shown". `make verify` green (277 API + 499 UI); e2e
    `analytics.spec.js` (4 tests) passes.
  - **Run stage 18 is complete.** Not pushed or deployed. Deploying runs
    migration 0014; set the Fly secrets `UMAMI_URL` and
    `UMAMI_WEBSITE_ID` first. Next (Julian): plan offline analytics.
- **Run stage 17 ✅ (2026-10-07)** on branch
  **`roles-and-viewers`**, stacked on `points-of-interest` (Julian: stack
  them). Quiet offline (no "Network Error" toasts for reads), making
  someone an admin from the Admin page's table, what viewers see, and a
  viewer's map with only activities and public memories. Plan:
  `docs/plan/run-17-offline-toasts-roles-viewers.md`; answers in.
  - **Phase 72 ✅:** quiet offline: a read that can't reach the server
    never toasts; a write says "You’re offline, so that wasn’t saved."
    once. `make verify` green (260 API + 465 UI); e2e `offline-toasts`.
  - Julian: carry on through Phases 73–75 without stopping.
  - **Phase 73 ✅:** Role (User / Admin) in the Admin page's table,
    `PATCH /admin/users/:id`; not your own row, never the last admin.
    `make verify` green (266 API + 468 UI).
  - **Phase 74 ✅:** viewers get Timeline, Journal and Map; no Today, no
    Stays / Travel views, no Trip tools (`NotForViewers`); the server
    refuses them weather and packing. `make verify` green (267 API + 475
    UI).
  - **Phase 75 ✅:** a viewer's map: the server sends viewers no points of
    interest, and stays' and legs' places only by name and city, so only
    activities and public memories are pins. `make verify` green (271 API
    + 478 UI).
  - **Run stage 17 is complete.** Not pushed or deployed. Deploying runs no
    new migration.
- **Run stage 16 ✅ (2026-10-06)** on branch **`points-of-interest`**
  (off `main` after PR #15): points of interest on the map, one Filter
  button, the map's List button. Plan: `docs/plan/run-16-points-of-interest.md`.
  Answers: all as recommended (2026-10-06).
  - **Phase 68 ✅:** points of interest on the server (`PointOfInterest`,
    migration 0013, `/trips/:id/points-of-interest`, `pointsOfInterest[]` in
    the trip document and the read). Named "point of interest" throughout,
    never "place" (Julian). `make verify` green (260 API + 433 UI).
  - Julian: go ahead with Phases 69–71 without stopping between them.
  - **Phase 69 ✅:** points of interest on the map (pins, "Point of
    interest" from a search result, the form, Edit and Delete in the info
    window). `make verify` green (260 API + 451 UI). The dev database was
    migrated (`make migrate`) for the e2e.
  - **Phase 70 ✅:** one Filter button (Everything, Stays, Points of
    interest, Journal) in place of the Journal and Stays toggles. `make
    verify` green (260 API + 453 UI).
  - **Phase 71 ✅:** the map's List button (bottom left, above Google's
    logo): what's on the map, grouped with icons; a row jumps to its pin.
    `make verify` green (260 API + 459 UI); map e2e specs pass.
  - **Run stage 16 is complete.** Pushed (`points-of-interest`, no PR yet)
    and deployed to Fly from the branch (2026-10-07); migration 0013 ran on
    start. **Julian:** try it on the phone.
- **Run stage 15 ✅ (2026-10-06)** on `details-page`: New memory (blue
  icon) in the top bar in Share's place; Share trip in the drawer after
  Documents; Currency first in Trip tools; Journal's and Today's New memory
  buttons gone; Today shows the temperature now. `make verify` green (246
  API + 428 UI). **Julian: look at it on the phone.**
- **Run stage 14 change (2026-10-06):** the pull between entries stays
  within the entry's day (never into the next day); an overnight leg's
  arrival row is its own step on the day it lands. `make verify` green.
- **Run stage 14, in progress (2026-10-06)** on branch **`details-page`**:
  swipe up/down between entries on an entry's page. Plan:
  `docs/plan/run-14-swipe-between-entries.md` (answers: across days; ← to the
  trip timeline; 80 px; keep visible Previous / Next for now).
  - **Phase 65 ✅:** `entrySequence()`/`neighbours()` in `entries.js` (the
    timeline's rows across days, no "Staying at" rows, no same-day leg
    arrival); rows pass `atKey` in router state so a stay's check-out steps
    on from check-out; "↑ Previous" / "Next ↓" rows on the page (replace the
    URL); the entry view is keyed so a move doesn't show the old photo. `make verify`
    green (246 API + 407 UI). E2E screenshots `04c`, `04d`.
  - **Phase 66 ✅:** the pull. `useEdgePull` (`features/entry/`) watches the
    scroll root's touches and only takes over at an end, pulling outward
    (`overscroll-behavior-y: contain` while the page is open); the page
    follows the finger at half speed with "Pull for / Release for next";
    past 80 px it moves, short of it it springs back; the new entry slides
    in from that side (not with reduced motion). Off while a dialog is open,
    sideways, or with two fingers. The test trip moved to
    `src/test/sampleTrip.js`. `make verify` green (246 API + 418 UI); e2e
    with real touches (CDP) at 375 px, screenshots `04e`, `04f`.
  - **Changes (2026-10-06, Julian):** Previous / Next rows removed (the
    pull's hint now names the entry); ← goes back where you came from
    (entry → day, day → timeline; else the entry's day / the timeline); the
    day page's ← moved into ☰'s place. Fixed with it: after swiping on a
    page opened directly, ← went nowhere (`shared/utils/firstEntry.js`);
    a long scroll no longer runs on into a pull (a pull needs a touch that
    starts at the end). `make verify` green (246 API + 422 UI); e2e green.
  - **Julian: try it on the phone**, iOS especially (the rubber-band inside
    a scroll area is what Chromium can't show).
- **Run stage 13, in progress (2026-10-06)** on branch **`details-page`**
  (off `enhance-trip`). Plan: `docs/plan/run-13-entry-page.md`. All
  recommendations taken; the confirmation number moves to the top.
  - **Phase 62 ✅:** an entry's own page (`/trips/:id/activities|stays|travel/:id`),
    view only. `make verify` green (246 API + 401 UI tests).
  - **Phase 63 ✅:** Edit and Delete on the page (editors; greyed offline;
    Delete goes to the entry's day). `make verify` green (406 UI tests).
  - **Phase 64 ✅:** every way in opens the page (day and Today rows, Stays/
    Travel cards, search, map pins' Details, old `?open=` links);
    expand/collapse and the booking dialog are gone; Move up/down is under
    an activity's ⋯ on the day page. `make verify` green (246 API + 398 UI).
  - **Fix (2026-10-06):** the ⋯ menu (Move up/down, and every other ⋯) was
    clipped inside its row; `RowMenu` now floats over the page (portaled,
    opens upward near the bottom). Screenshot `03d`.
  - **Run stage 13 is complete.** **Julian:** look at an entry's page on the
    phone. The e2e specs signing in as `pripri@` fail only because that
    dev password was changed (`make reset-db`).
- **Earlier stages:** all complete (Run stage 12's last question, Q-B8, was
  answered "keep it as it is"). Their status notes and "What exists (by
  phase)" are in [docs/progress-history.md](docs/progress-history.md); the
  plans are indexed in [implementation_plan.md](implementation_plan.md).

## Next

1. **Julian:** look at Phases 11–15 at phone width and confirm them — the
   Playwright screenshots in `ui/e2e/screenshots/` are a stand-in, not the
   gate. Phases 3, 4, 6, 8, 9 and 10 also have manual phone-width gates.
2. **Julian:** add the LAN IPs as allowed referrers on the Google Maps
   browser key (Google Cloud console) if he wants live Places search to work
   from a LAN address, not just `localhost:3000`.
3. `example-trip.json` (Julian's real upcoming Okinawa/Taipei trip) has been
   re-imported (after the 2026-10-02 `make reset-db` wiped it) and
   backfilled with real photos via the name-search path — done, in the dev
   database now.
4. **Julian:** look at Run stage 1 at 375px: map search, adding from the
   map, and offline (DevTools → Network → Offline). Then deploy to Fly
   (HTTPS), install it on the phone, and try it in airplane mode before the
   Okinawa trip (Oct 29).
5. **Run stage 4, on `journal-memories`** (in progress; see Status).
   Offline memories, location and the blue dot, and photos (originals kept,
   unguessable URLs, a ~10 GB Fly volume). **Before deploying photos:**
   `fly volumes extend` to about 10 GB.
6. **Julian (deploy):** set `SEED_*` secrets on Fly before the next
   `make seed-remote`. Since 2026-10-04 the container no longer seeds on boot
   (it replanted the demo trips, deleting their memories and photos, on every
   wake from auto-stop). Seeding is only `make seed-remote`. The accounts
   already on Fly were made with the default passwords, so change those too.
7. **Julian:** try Run stage 3 at 375px. Sign in as `pripri@example.com` /
   `changeme-viewer` for the viewer's side (`make seed` created it, already
   joined to the sample trip).
8. **Julian:** look at Run stage 2 (Phases 20–24) at 375px. Keep or revert
   the Plan | Stays | Travel control.
   Then the text-size preference (the next follow-up), and later showing
   the Today tab only while a trip is active.
9. **Then, from the backlog:** editing the trip header; verification/gaps
   (rebuilt from `docs/lessons_learned.md`); merging `rebuild` into `main`;
   anything past Walk stage 3 (map search/filters was the last planned
   phase there) needs a fresh look at what's next.

## Moving to another machine

Everything needed to build and run is in git on `origin/rebuild`. Setup:

```bash
git clone git@github.com:julian-h-dale/PriPriTrip.git && cd PriPriTrip
git checkout rebuild
make setup      # venv + npm install; creates api/.env with a fresh JWT_SECRET
make seed       # seed users + the sample trip
make dev        # API :8000 + UI :3000
make verify     # should be green: 133 API + 217 UI tests
```

Tested with Python 3.12.3, Node 24.14 and npm 11.11.

**Not in git** (copy by hand if you want it):
- `reference/private/`: personal PDFs and notes from v1, plus backups of the
  old `api/.env` and `ui/.env.local`. The old OpenAI and Maps keys are in
  there; nothing in the rebuild uses them yet.
- `GOOGLE_MAPS_API_KEY` in `api/.env` (the key exists and works): `make
  setup` makes a fresh `api/.env` without it, so copy the key across by hand
  (or from the Google Cloud console). Its referrer restriction covers
  `http://localhost:3000/*`, so it works on any machine on that port.
- `api/data/app.db`: the dev database. It's disposable: `make reset-db`
  recreates it, and edits made in the dev UI are lost.
- Claude's per-machine memory notes. The decisions that matter are copied
  under "Working agreements" below.

## Working agreements (carry these to any machine or agent)

- **No Claude attribution in commits or PRs** (no `Co-Authored-By`,
  `Claude-Session` or "Generated with" lines). Julian, 2026-10-02.
- **Keep the forms hand-written.** Julian edits trip data through them as a
  deliberate check by eye; don't generate them from a schema.
- **Alembic from Phase 29a on** (Julian, 2026-10-03: the app is deployed
  after `rebuild`). Every schema change gets a migration
  (`alembic revision --autogenerate`, then review it). `make migrate`
  applies them, and start.sh and dev.sh run it. 0001 is the schema as
  deployed from `rebuild`. A pre-Alembic database is stamped there, not
  rebuilt.
- **Local-only, private repo.** Personal trip material in `reference/` is
  fine to keep in git.
- **AI/chat is out of scope** until the core timeline and editing are solid.
- **Stay on React 18** (the template's version) and build our own vertical
  timeline, not react-chrono. Decided 2026-10-02.
- **No timezone pickers.** A time's zone is inferred from its place; users
  only enter wall-clock times. Zones are computed on read
  (`api/app/zones.py`), never stored. Decided 2026-10-02.
- **Google Places runs in the browser**, with the key from `GET /config`. It's
  a browser key protected by website and API restrictions in Google's console;
  the server never calls Google. Decided 2026-10-02.
- **The template workflow:** plan → answer the open questions → one phase at a
  time, `make verify` green, update this file, commit.

## Notes / decisions

- v1 code lives on `main` (pre-rebuild) and `llm-translate`. Use it for
  knowledge, not code.
- Chat/AI and verification are out of scope until the core timeline is solid.
- Every import creates a new trip; invalid imports are rejected outright.
- **Gotcha:** after `make reset-db`, restart `make dev`. A running API keeps
  pooled connections to the deleted SQLite file, so logins and data silently
  disagree until it restarts.
- `ui/.env` doesn't exist (template `make env` only creates `api/.env`); the UI
  uses the defaults (:3000 → API :8000).
