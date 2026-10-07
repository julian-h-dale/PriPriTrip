# Run stage 18 — usage analytics (Umami)

Asked 2026-10-07 (Julian), on the `analytics` branch:
1. Send usage to the existing Umami instance
   (`https://aca-priprinote-analytics-prod.whitemeadow-13a698d2.centralus.azurecontainerapps.io/`,
   website id `47e094f1-fa75-4b58-9e35-4765b9ac78df`).
2. A per-user on/off switch, so testing doesn't pollute the numbers. On by
   default for everyone except admins.
3. Basic analytics: how often each page is landed on, and how often the
   Trip tools are used.
4. Each of these broken down by editor / viewer.
5. Not wanted: anything about inviting, joining or signing in.

## Where we are

- **No analytics at all.** No third-party scripts, and nginx sets no
  Content-Security-Policy, so loading Umami's `script.js` needs no header
  change.
- **Pages** (`ui/src/app/App.jsx`): All trips, the trip's timeline, Today,
  Journal, a day, an activity / stay / travel entry, Map, Weather,
  Currency, Packing, Documents, Time zones, Admin. Plus `/login`.
- **Trip tools** (the drawer, `NavDrawer.jsx`): Currency, Weather, Time
  zones, Packing, Documents, Share trip. Viewers don't get them (Run 17),
  so tool usage is only ever by an owner or editor.
- **Roles.** A role is per trip (`trip.role`: owner, editor, viewer), not
  per person: the same person can be an editor on one trip and a viewer on
  another. So the role goes with each page view, read from the trip on
  screen, not stored against the person.
- **Settings the client needs** come from `GET /config` (Maps key, Map ID).
  The Umami address and website id would join them there.
- **Users** (`users` table) have `is_superuser`, `timezone`,
  `must_change_password`; the Admin page's table lists them with a Role
  choice and a password Reset.

## Design (assuming the recommended answers)

### 1. Where the settings live (Q-A1)

- `api/.env` gets `UMAMI_URL` and `UMAMI_WEBSITE_ID`. Both empty by
  default, so `make dev` and the tests never send anything; production sets
  them. `GET /config` returns them (`umamiUrl`, `umamiWebsiteId`), like the
  Maps key: public by design.
- Neither is a secret: Umami's website id is in every page that uses it.

### 2. The per-user switch (Q-A2, Q-A3)

- **New column** `users.analytics_enabled`, a plain boolean, set once when
  the account is made: **on for users, off for admins**. After that only an
  admin changes it; making someone an admin (or a user) leaves it as it
  was (Q-A3).
- The migration fills existing rows the same way: off for admins, on for
  everyone else.
- `UserRead` gains `analytics_enabled`, snake_case like the rest of the
  fastapi-users schemas. `UserUpdate` doesn't take it, so nobody can
  change their own through `PATCH /users/me` (Q-A2).
- **The Admin page's table** gets an **Analytics** column: an On / Off
  choice for every row, your own included (that's how you turn yours off
  while testing). `PATCH /admin/users/:id` takes `{ analyticsEnabled }`,
  and `isSuperuser` becomes optional, so either can be changed alone.

### 3. Loading Umami only when it's on

> **Replaced in Run stage 19:** no Umami script; the app posts to
> `/api/send` itself through a queue on the phone
> ([run-19](run-19-offline-analytics.md)).

- One small module, `shared/analytics/umami.js`:
  - After sign-in, once `/users/me` and `/config` are known: if
    `analytics_enabled` and both settings are set, add Umami's `script.js` with
    `data-website-id`, `data-host-url` and **`data-auto-track="false"`**
    (we send page views ourselves, see 4).
  - If it's off, or the settings are empty, nothing is loaded and every
    `track` call is a no-op.
  - Signing out (or an admin turning it off) stops sending from the next
    load. A page left open keeps the script until it reloads; acceptable.
  - Failures are silent: an ad blocker, offline, or Umami down never shows
    a toast and never breaks the page.
- **Offline:** events made offline are simply lost (Umami's tracker
  doesn't queue). The service worker doesn't cache the script; it's a
  different origin.
- **Nothing personal is sent** (Q-A4): no email, name, trip name, trip id
  or entry id. Umami is cookieless; it counts visitors by a daily hash of
  IP and browser.

### 4. Page views (Q-A5, Q-A6)

- **Sent on every route change** by one hook in `App.jsx`
  (`usePageViews`), not by each page.
- **The URL is the route's pattern, not the real address**, so no ids leave
  the app and Umami's Pages report groups naturally:
  `/trips/:tripId/days/:date` → `/trips/_/day`. The names Umami shows:

  | Page | Sent as |
  |---|---|
  | All trips | `/trips` |
  | Timeline | `/trip/timeline` |
  | Today | `/trip/today` |
  | Journal | `/trip/journal` |
  | A day | `/trip/day` |
  | An activity / stay / travel | `/trip/activity`, `/trip/stay`, `/trip/travel` |
  | Map | `/trip/map` |
  | Weather, Currency, Time zones, Packing, Documents | `/trip/weather`, … |
  | Admin | `/admin` |
  | Sign-in | *not sent* |

  The title is the page name ("Map"), never the trip's name.
- **The role goes with it:** each page view also carries `role`
  (`owner`, `editor` or `viewer`, Q-A5) as event data. Pages outside a
  trip (All trips, Admin) carry `role: none`.
  - **Built (Phase 77):** your instance's tracker is a recent Umami (it
    has `tag`, `distinct-id`, `before-send`), so it's one call: the role
    is the page view's **tag** (Umami's filters have Tag) and its event
    data. Pages outside a trip have `none`.
- **The timeline's Plan / Stays / Travel switch** counts as its own page
  view (`/trip/timeline/stays`), so you can see if the views get used.
- Swiping between days or entries is a route change, so it counts. That's
  "landed on" in practice; Q-A6 asks if you'd rather count only arrivals
  from somewhere else.

### 5. Trip tools (Q-A7)

Page views already say how often each tool is opened. On top of that, a
named event when a tool is actually *used*, each with `{ role }`:

| Event | When |
|---|---|
| `tool-open` `{ tool }` | A tool is opened from the drawer (vs. a link or Back) |
| `currency-convert` `{ currency }` | An amount is typed and converted (once per visit, not per keystroke) |
| `weather-view` | A forecast is shown (once per visit). *Built:* the page has no day to tap open, so this is "the forecast loaded", not "a day opened" |
| `timezones-view` | The Time zones page shows clocks (once per visit) |
| `packing-check` / `packing-add` `{ from: typed \| suggestions }` | An item is ticked (not unticked) / added |
| `document-upload` `{ replacing }` / `document-open` `{ all? }` | A document is added or replaced / opened, or all downloaded |
| `share-open` | The Share dialog is opened (not the inviting itself) |

Viewers never fire these (no Trip tools), so for tools the split is
owner/editor only, which the role still shows.

### 6. Reading it in Umami

- **Pages:** Umami's dashboard → Pages lists `/trip/map` etc. with counts.
- **By role:** add a filter on **Tag** (owner / editor / viewer) to the
  dashboard, so Pages shows that role's counts; or a Breakdown report on
  URL × the `role` property.
- **Tools:** Events lists each tool event; its `role` property splits it
  (owner / editor).
- No dashboard in the app: Umami is the dashboard.

## Phases

- **Phase 76 — the per-user switch.**
  - **Scope:**
    - `users.analytics_enabled` + migration (off for admins, on for the
      rest); on `UserRead`.
    - New accounts (invites, the seed) get it from whether they're an
      admin.
    - `PATCH /admin/users/:id` accepts `analyticsEnabled` (any row, your
      own included).
    - The Admin table's Analytics column (On / Off).
    - `UMAMI_URL`, `UMAMI_WEBSITE_ID` settings, returned by `/config`;
      documented in `api/.env.example` and `deploy/README.md`.
  - **Tests:**
    - A new user starts on, a new admin off; the migration fills existing
      rows the same way; a role change leaves it alone.
    - The PATCH: set / clear for another user and for yourself; a non-admin
      gets 403.
    - `/config` returns the Umami settings (empty when unset).
    - The Admin table's column and its choices.
- **Phase 77 — page views with the role.**
  - **Scope:**
    - Check the Umami instance's version: whether page views carry data
      (decides one call or two, see 4).
    - `shared/analytics/umami.js` (load only when on; no-op otherwise).
    - `usePageViews`: route pattern → page name, with the trip's role.
    - The timeline views switch as page views.
  - **Tests:**
    - Off (admin default, explicit off, or no settings): no script, no
      calls.
    - On: the script tag has auto-track off; a route change sends the
      pattern (no ids anywhere in the payload) and the role.
    - `/login` sends nothing.
  - **E2E:** in production (or dev pointed at Umami), as the seed user and
    the seed viewer, move through every page; the Umami dashboard shows
    each page with the right role. As the admin, nothing arrives.
- **Phase 78 — Trip tools events.**
  - **Scope:** the events in 5, each through `umami.js` with the role.
  - **Tests:** each tool fires its event once per action (Currency once
    per visit, not per keystroke); nothing fires when analytics is off.
  - **E2E:** use each tool once; each event shows in Umami with
    `role: owner` (or `editor`).

## Open questions

- **Q-A1. Where should the Umami address and id live?**
  - (a) *Recommended:* `api/.env`, served by `/config`. Empty in dev, so
    local testing sends nothing even with your switch on.
  - (b) Hard-coded in the UI. Simpler, but every dev session and the
    tests would send data unless switched off.
  - **Answer:** (a). Locally in `api/.env`; on Fly as secrets (`fly secrets set UMAMI_URL=… UMAMI_WEBSITE_ID=…`), which reach the app as environment variables. Served by the existing `GET /config`. (Julian, 2026-10-07)
- **Q-A2. Who flips the switch?**
  - (a) *Recommended:* admins only, from the Admin table (including their
    own row).
  - (b) Also each person for themselves, in the drawer ("Share usage
    analytics"), as a privacy opt-out.
  - **Answer:** (a), admins only. (Julian, 2026-10-07)
- **Q-A3. When someone becomes an admin, does their default follow?**
  - (a) *Recommended:* yes: unset means "on for users, off for admins",
    so promoting someone turns theirs off unless it was set by hand.
  - (b) No: the default is fixed when the account is made.
  - **Answer:** (b). The default is set when the account is made; after that it changes only by hand, so promoting someone leaves it as it was. (Julian, 2026-10-07)
- **Q-A4. Tell Umami who someone is?** Umami can tie visits to an id
  (`identify`) so you'd see "this person used Packing 12 times".
  - (a) *Recommended:* no: anonymous counts only; the role is the only
    thing about a person that's sent.
  - (b) Yes, an opaque id (the user's UUID, never email or name).
  - **Answer:** (a), no identifying; only the role is sent. (Julian, 2026-10-07)
- **Q-A5. Owners: their own role, or counted as editors?**
  - (a) *Recommended:* send `owner`, `editor`, `viewer` as they are; Umami
    can show owner + editor together, but they can't be split later if
    they're merged now.
  - (b) Send `editor` for owners too (just the two you asked for).
  - **Answer:** (a), keep `owner`. (Julian, 2026-10-07)
- **Q-A6. What counts as "landed on"?**
  - (a) *Recommended:* every route change, swipes between days and
    entries included.
  - (b) Only arriving at a page from a different page (swiping day to day
    counts the day page once).
  - **Answer:** (a). (Julian, 2026-10-07)
- **Q-A7. Tool events: the list in 5 or just opens?**
  - (a) *Recommended:* the list in 5: opens plus one "used it" event per
    tool.
  - (b) Opens only (page views already cover this; Phase 78 is dropped).
  - **Answer:** (a). (Julian, 2026-10-07)
