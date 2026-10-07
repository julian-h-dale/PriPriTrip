# Run stage 10 — public memories, photo backup to the Pi, weather, currency, countdown

Asked 2026-10-05 (Julian), five features:
- **Photo backup to the Pi.** The Raspberry Pi on the home network is always
  on (Tailscale later, for remote access). Every ~30 minutes a job checks for
  newly uploaded photos, downloads them and saves them to a 512 GB thumb drive.
- **Public and private memories.** The in-laws will join as **viewers** to
  follow the itinerary. Viewers see the plan, the map and **public** journal
  entries only. Every memory is **private by default**. Julian and PriPri are
  both **editors** (owner + editor), see every memory, and can mark an entry
  public. (Instead of texting 20 photos a day.)
- **Weather.** A weather endpoint for the trip's **places** (not the phone's),
  for every day of the trip, as far ahead as the API allows, plus today's
  weather. Cached on the server; a request reads the cache and refreshes
  anything more than 12 hours old. OpenWeatherMap, key in `api/.env` and as a
  Fly secret. Works before the trip starts.
- **Currency.** A converter: the rate from USD to the trip's currency, and a
  calculator (local amount in, USD out). Frankfurter. Rates cached on the
  device so a calculation never re-requests.
- **Weather and Currency are their own pages**, reached from the ☰ drawer, not
  added to the tab bar or the trip screens.
- **Countdown** on the All trips screen for an upcoming trip: to midnight at
  the start of its first day, against the phone's clock. One unit at a time:
  days while more than 24 hours remain, then hours, then minutes.

**Decisions (answered 2026-10-05):** every recommendation below, and the
backup drive is ext4 on a Raspberry Pi 5 (Q-B5).

**Order (Q-O1):** public memories first (it must land before the in-laws
are invited, because today every viewer sees every memory), then the backup
(before the trip), weather, currency, and the countdown. Each is independent,
so the order can change.

### Where we are

- **Roles:** owner (`trips.user_id`), and `TripMember.role` `"editor"` or
  `"viewer"`. `get_viewable_trip` lets in all three, `get_editable_trip`
  owner or editor. **Every member can read and write memories today**
  (`selectCanWriteMemory`), and `GET /trips/{id}/memories` returns all of
  them. So a viewer sees every memory and its photos.
- **The viewer code is the trip's id**, which is in every trip URL. A viewer
  also sees everything on the plan, including confirmation numbers (Q-S4,
  answered when the only viewer was a traveler).
- **Photos** are files under `PHOTO_DIR` (`/data/photos` on the Fly volume),
  with a `photos` row each, served at `GET /photos/{id}/{variant}` with no login
  check (the random id is the secret). There is no way to list photos except
  through a trip's memories, and no off-site copy: only Fly's 5-day snapshots
  (Run stage 4 said an off-site copy comes "before relying on it for a real
  trip").
- **The Fly machine** auto-stops when idle but keeps `min_machines_running =
  1`, and runs one gunicorn worker.
- **Places** carry `lat`/`lng` and a `city`; every entry's zone is computed
  from its coordinates (`zones.py`, tzfpy). There is no country or currency
  field.
- **Checked today (2026-10-05):**
  - Frankfurter v2 needs no key, sends `Access-Control-Allow-Origin: *`, and
    covers both of this trip's currencies (`/v2/rates?base=USD&quotes=JPY,TWD`
    gave JPY 157.93, TWD 31.821).
  - OpenWeatherMap's One Call 3.0 answers 401 unless the key has the "One Call
    by Call" subscription (tested with a dummy key, so this only shows the
    endpoint's rule, not Julian's key).
- **The backup Pi is a Raspberry Pi 5** with a drive dedicated to the backup
  (Q-B5). The install script doesn't assume it's this checkout's machine.

### Design: public and private memories

- **`memories.is_public`**, a boolean, default `false` (migration 0007).
  Existing memories become private. The phone sends it with the memory, so
  it goes through the outbox like any other edit and works offline.
- **Who sees what, in one place.** `services/memories.list_memories` filters
  by the caller's role:
  - owner and editors: every memory;
  - viewers: public memories only (and their own, if any exist from before).
  The same filter guards `GET` of a single memory, the memories in the
  offline cache, the map's memory pins and the photos listed on a memory, so
  a viewer is never handed a private photo's id. A private memory reads as
  **404** to a viewer, like a foreign row.
- **Viewers no longer write memories** (Q-P2): `POST` gives 403 for a viewer,
  `selectCanWriteMemory` becomes "online-or-outbox and owner or editor", and
  New memory is hidden for viewers. Their Journal tab is a read-only feed of
  public entries, with an empty state ("Nothing shared yet").
- **Who marks it public** (Q-P1): the author, in the memory dialog: a
  "Visible to viewers" switch, off by default. Public memories get a small
  "Public" badge for editors so it's clear what the in-laws can see. Any
  editor's view shows the badge; only the author flips it.
- **Booking details for viewers** (Q-P3): `confirmationNumber` is removed from
  stays, travels and activities in `TripRead` for viewers, server-side (in
  the read model, so the offline cache never holds it either). Notes stay.
  Export, which viewers can call, strips it too.
- **A revocable view code** (Q-P4): `trips.view_code`, a random secret made and
  renewed like `edit_code` (same generator, same Share dialog row). Joining
  with the trip id keeps working only for people who already joined; new
  viewers need the code. "New view code" stops the old one; people already on
  the trip stay.
- **Accepted limitation:** making a public memory private again hides it from
  then on, but a viewer's phone may still hold the thumbnails it cached, and a
  photo URL someone saved keeps working (it's unguessable, not signed). Fine
  for "they already saw it". Signed photo URLs remain the upgrade path.

### Design: photo backup to the Pi

- **An admin manifest:** `GET /admin/backup/photos?after=<cursor>` (superuser,
  under the existing `/admin` router, so it's protected by construction).
  Every live photo across all trips, oldest `received_at` first, 500 per page,
  each with: photo id, trip id and name, memory id, author name, the memory's
  local time and zone, original format and bytes, and the original's URL. The
  cursor is `(received_at, id)`, so a page can't skip a photo uploaded mid-run.
- **A journal dump:** `GET /admin/backup/journal/{trip_id}`: the trip's
  memories (text, times, zone, place, public flag, author, photo ids) as JSON
  (Q-B2). The trip export (Run stage 8) is plan-only, so this is the only copy
  of the journal's words outside Fly.
- **The Pi script:** `scripts/pi-backup/pripri_backup.py`, Python 3 standard
  library only (nothing to `pip install` on the Pi).
  1. **Refuses to run unless the drive is mounted** (`os.path.ismount`).
     Otherwise it would quietly fill the SD card.
  2. Signs in (`POST /auth/login`), reading `API_URL`, `BACKUP_EMAIL` and
     `BACKUP_PASSWORD` from `/etc/pripri-backup.env` (mode 600).
  3. Pages through the manifest from the cursor saved last time
     (`state.json` on the drive, so the drive knows what it holds).
  4. Downloads each original to `<name>.part`, checks the byte count, then
     renames: a crash never leaves a half photo with a real name. A file that
     already exists with the right size is skipped, so a lost state file only
     costs a re-scan, not a re-download.
  5. Rewrites each trip's `journal.json` when any of its photos changed (and
     at least daily).
  6. Logs a one-line summary ("3 new photos, 41 MB").
- **Layout on the drive** (`/mnt/pripri-backup/PriPriTrip/`):
  `<trip-name-slug>/<YYYY-MM-DD>/<HHMM>_<author>_<photo-id-8>.<ext>`, dated by
  the memory's local time where it was written, plus
  `<trip-name-slug>/journal.json`. Browsable from any computer.
- **Never deletes** from the drive (Q-B3): a photo deleted in the app stays in
  the backup. It's a backup, not a mirror.
- **Scheduling: a systemd timer**, not cron: `OnCalendar=*:0/30`,
  `Persistent=true` (a run missed while the Pi was off happens at boot), and
  logs in `journalctl -u pripri-backup`. `scripts/pi-backup/install.sh`
  installs the unit files and the env file template; `make pi-backup-install`
  calls it (a script, not hand setup, per AGENTS.md). The drive is formatted
  **ext4** (dedicated to the backup, never leaves the Pi; Q-B5), mounted by
  UUID in `/etc/fstab` with `nofail`, so the Pi still boots without it.
- **Network:** the Pi pulls from `https://pripri-trip.fly.dev/api`; nothing
  connects to the Pi, so Tailscale isn't needed for the backup (only for
  reaching the Pi yourself).
- **Known gap:** photos still waiting on a phone (not uploaded, Run stage 5)
  aren't on the server, so they aren't backed up until uploaded.

### Design: weather

- **Source: OpenWeatherMap One Call 3.0** (Q-W1), one key, server side only:
  - `/data/3.0/onecall` per place: **current** conditions, **8 days** of daily
    forecast and **alerts** (late October is still typhoon season in Okinawa);
  - `/data/3.0/onecall/day_summary` per trip day beyond the 8 days: OWM's
    daily aggregate, which reaches up to 1.5 years ahead, so every trip day
    shows something weeks before the trip. Labelled **"Long-range outlook"**,
    never as a forecast.
  - Phase 50 starts with a spike against Julian's real key to confirm both
    endpoints and what `day_summary` returns for a future date before building
    on it.
- **Which place is a day's weather** (Q-W2): where you sleep that night (the
  stay covering it); on a travel day with no stay, the arrival place of the
  day's last leg; otherwise the previous day's place. One place per day,
  shown with its `city`. Places are rounded to 2 decimal places (~1 km) so
  nearby days share one lookup. The rule is one pure function
  (`services/weather.day_places`), tested on its own.
- **Today** (Q-W3): during the trip, current conditions at today's place;
  before it, at the first day's place ("Naha right now"); after it, none.
- **Data points per day:** condition and icon, high and low, feels-like
  (day), chance and amount of rain, humidity, wind and gusts, UV index,
  sunrise and sunset. Current: temperature, feels-like, condition, humidity,
  wind, UV. The long-range outlook has fewer (high, low, rain amount,
  humidity, cloud, wind).
- **Units** (Q-W4): stored metric (OWM's `units=metric`); the page shows °F
  and mph with °C beside the high/low. Converting on display means a units
  change never needs a refetch.
- **The cache:** a `weather_cache` table: `key` (unique, e.g.
  `onecall:26.22,127.69` or `day:26.22,127.69:2026-11-02`), `payload` (JSON as
  OWM sent it), `fetched_at` (`UtcDateTime`). It's a cache of public data keyed
  by place, so it's **not user-owned and not soft-deleted** (rows are
  upserted); this is a deliberate exception to the domain-row conventions, as
  no user's data is in it.
- **`GET /trips/{id}/weather`** (`get_viewable_trip`, so viewers get it too):
  1. works out each day's place;
  2. reads the cache; anything older than 12 hours is refreshed from OWM, in
     parallel (`httpx`, 10 s timeout), one refresh per key at a time (a lock),
     so two phones opening the page don't double the calls;
  3. a failed refresh serves the stale entry, marked with when it's from;
     nothing cached and no answer means that day says "Unavailable";
  4. returns `{ today, days: [{ date, place, kind: "forecast" | "outlook" |
     "none", fetchedAt, ... }], alerts }`, normalised (the page never sees
     OWM's raw shape).
  - Past days return `none` (no historical lookups).
  - No key set: 503 "Weather isn't set up", and the page says so.
- **No scheduled job** (Q-W5): refreshing on request does what "once a day"
  would, and calls OWM only when someone looks. Budget: about (places + days
  beyond 8) calls per 12 hours, roughly 25 for this trip, against the free
  1,000 a day.
- **Key setup:** `OPENWEATHER_API_KEY` in `api/.env` (and `.env.example`), and
  `fly secrets set OPENWEATHER_API_KEY=…`. Never sent to the browser.
- **Offline:** the last weather response is cached with the trip, so the page
  shows it offline with "Updated 5 hours ago".

### Design: currency

- **No backend** (Q-C1). The browser calls Frankfurter directly (no key, CORS
  open). Server caching would add a table and an endpoint for nothing: the
  rates are public, and the phone has to cache them anyway to work offline.
- **Device cache:** `GET /v2/rates?base=USD&quotes=<the trip's currencies>`,
  stored with its fetch time (localStorage, wrapped in try/catch). Reused for
  12 hours; every calculation uses the stored rate. A failed or offline fetch
  uses the stored one with "Rate from Oct 5". Never fetched → "Connect once to
  get today's rate".
- **Which currencies** (Q-C2): from the trip's places. Each entry already reads
  with its computed `zone`; a pure `tripCurrencies(trip)` maps zone → country
  (tzdata's `zone.tab`) → currency (a small table), in place order. The
  lookup table is generated once by `scripts/gen-zone-currency.py` and
  committed as `ui/src/features/tools/zoneCurrency.js`. Okinawa & Taipei →
  JPY, TWD. Chips switch between them, defaulting to today's place during the
  trip; "Other…" picks any Frankfurter currency (remembered per trip on the
  device).
- **The page:** "1 USD = 157.93 JPY" (and the inverse, "¥100 = $0.63"), the
  rate's date, and a calculator: a large numeric input in the local currency,
  the USD result live below it. A swap button turns it USD → local (Q-C3).
  Labelled a **reference rate**: cards and ATMs add their own margin.

### Design: the pages and the drawer

- Routes: `/trips/:tripId/weather` and `/trips/:tripId/currency`, each a plain
  page with the top bar and a back arrow (no bottom tabs).
- The ☰ drawer gets **Weather** and **Currency** under a "Trip tools" heading,
  shown only while a trip is open (Q-N1). Nothing else changes on the trip
  screens.
- Follows `design_doc.md`: loading skeletons, the empty and error states, and
  toasts only for actions.

### Design: countdown

- **On upcoming trip cards** on All trips: "24 days to go", then "5 hours to
  go", then "12 minutes to go", then "Starting now" under a minute.
- **The target** (Q-D1): midnight at the start of `startDate` on the
  **phone's** clock (the local midnight of that date, wherever the phone is).
  For Okinawa: 12:00 AM Oct 29 in Chicago, half an hour before the 12:30 AM
  flight.
- **Units** (Q-D2): whole units rounded down (2 days 23 hours reads "2
  days"); "1 day"/"1 hour" singular. One pure function
  (`countdownLabel(startDate, now)`), tested at each boundary (exactly 24 h,
  23 h 59 m, 60 m, 59 m, 0, and across a daylight-saving change).
- It re-renders every 30 seconds while the page is open (one timer for the
  list, not one per card). Once the start passes, the trip moves to the
  current group as today, and the countdown disappears.

### Phases

- **Phase 46 — public memories (API).** ✅ (2026-10-05)
  - **Scope:** migration 0007 (`memories.is_public`, `trips.view_code`);
    `is_public` on create/update and in `MemoryRead`; the viewer filter in
    `services/memories`; viewers can't create (403); `confirmationNumber`
    stripped for viewers in `TripRead` and export; the view code (make, renew,
    join with it; trip id still works for existing members only).
  - **Tests:** a viewer lists only public memories, gets 404 for a private
    one, never sees a private memory's photo ids; owner and editor see all;
    the author flips `isPublic`, another editor can't (403); a viewer can't
    create; a viewer's trip and export have no confirmation numbers, an
    editor's do; join with the view code makes a viewer, an old code fails
    after renewing, the trip id no longer joins a new user; the migration
    upgrades a copy of a database with memories (all private).
- **Phase 47 — public memories (UI).** ✅ (2026-10-05)
  - **Scope:** the "Visible to viewers" switch (outbox-aware), the Public
    badge, viewers' read-only Journal with its empty state, New memory hidden
    for viewers, the Share dialog's view code with "New view code".
  - **Tests:** viewers see no New memory and no switch; the switch's value
    reaches the outbox entry; the badge shows for public memories; the Share
    dialog renews the view code.
  - **Julian, at 375px:** as an editor, mark one memory public; as the seed
    viewer, see only that one, with its photos.
- **Phase 48 — backup manifest (API).** ✅ (2026-10-05)
  - **Scope:** `GET /admin/backup/photos` (cursor pages) and
    `GET /admin/backup/journal/{trip_id}`.
  - **Tests:** superuser only (401/403 otherwise); cursor order is stable and
    complete across pages, including a photo added between pages; deleted
    photos are left out; the journal dump has every live memory, public or
    not.
- **Phase 49 — the Pi job.** ✅ (2026-10-05; install on the Pi pending)
  - **Scope:** `scripts/pi-backup/` (script, systemd service and timer,
    install script, env template), `make pi-backup-install`, a README section
    (formatting and mounting the drive by UUID, the env file, checking
    `journalctl`).
  - **Tests:** pytest for the script against a fake server: refuses when the
    drive isn't mounted; resumes from the cursor; a `.part` file never becomes
    a photo when the size is wrong; skips files already there; deleted
    photos stay on disk.
  - **Julian:** install on the Pi, upload a photo from the phone, and see it on
    the drive within 30 minutes.
- **Phase 50 — weather (API).** ✅ (2026-10-05; live check pending a key)
  - **Scope:** the spike against the real key (results noted here first, and
    raised if the long-range data isn't what's described); `weather_cache`
    (migration 0008); `services/weather.py` (day places, refresh, normalise);
    `GET /trips/{id}/weather`; `OPENWEATHER_API_KEY`.
  - **Tests (OWM mocked):** day places for stays, travel days and gaps; a fresh
    cache makes no call, a 13-hour-old one refreshes; a failed refresh serves
    stale data; two concurrent requests make one call per key; days past the
    8-day window use the outlook; past days are `none`; no key is 503;
    viewers can read it, strangers get 404.
- **Phase 51 — weather (UI).** ✅ (2026-10-05)
  - **Scope:** the drawer's Trip tools, the Weather page (today, alerts, the
    day list with forecast/outlook/unavailable states), offline caching.
  - **Tests:** each day state renders; °F/mph with °C; alerts show; the drawer
    shows Trip tools only in a trip; offline shows the cached copy with its
    age.
  - **Julian, at 375px:** the Okinawa trip's weather page.
- **Phase 52 — currency (UI).** ✅ (2026-10-05)
  - **Scope:** the zone → currency table and its generator, `tripCurrencies`,
    the rate cache, the Currency page and calculator.
  - **Tests:** JPY and TWD for the Okinawa trip; a cached rate within 12 hours
    makes no request, an older one refetches, a failed fetch uses the cached
    one with its date; the calculator's maths and rounding (USD to the cent; JPY and
    TWD to whole units); swap.
- **Phase 53 — countdown (UI).** ✅ (2026-10-05)
  - **Scope:** `countdownLabel`, the label on upcoming cards, the shared timer.
  - **Tests:** every boundary listed above; only upcoming trips get it.

### Built (2026-10-05): Phases 46–53

Julian answered the questions with "your recommendations" and asked for all
phases to be built in one go, with the app never failing for want of a
weather key. One commit per phase, each with `make verify` green (final: 218
API + 330 UI tests). The e2e suite (22 specs, 375 px) passes live; new
screenshots `24-journal-viewer`, `25-memory-public-switch`, `30`–`34` (trips
countdown, drawer, weather, currency).

**As planned, with these details and deviations:**
- **Public memories (46–47).** `memories.is_public` and `trips.view_code`
  (migration 0007, plain `ADD COLUMN`s). The viewer rule lives in
  `services/memories.visible_to`. A viewer sees public memories plus any
  they wrote themselves before this change. `get_journal_trip` stops
  viewers from writing (403). `get_own_memory` returns 404 when a viewer
  touches someone else's private memory.
  - **Joining by trip id:** it now works only for someone already on the
    trip, and changes nothing (no switching to viewer). New people need the
    view or edit code.
  - **Fixed along the way:** the outbox's send step picked fields one by
    one, so it would have dropped `isPublic`.
- **Backup (48–49).** Deviation: one `GET /admin/backup/journals` returns
  every trip's journal, rather than one call per trip, so the Pi doesn't
  need a trip list. Photos are ordered by upload time (`photos.created_at`
  is the server's stamp; photos have no `received_at`).
  - Added `python -m app.make_admin <email>`, because the Fly image has no
    `sqlite3` command to make the backup account a superuser.
  - The Pi script's tests (`api/tests/test_pi_backup.py`) run against a fake
    server, and `make lint` covers `scripts/pi-backup/`.
- **Weather (50–51).**
  - **The spike didn't run:** there's no `OPENWEATHER_API_KEY` locally. The
    code follows OWM's documented One Call 3.0 and `day_summary` shapes and
    is tested against a fake. **First thing with a real key:** open the
    weather page for the Okinawa trip. Check that days more than 8 days out
    show an outlook (not "No forecast yet"), and that the forecast days line
    up with the right dates.
  - Deviation: with no key, the endpoint answers **200
    `{configured: false}`** rather than 503, so nothing raises an error toast
    and nothing can fail. A rejected key, a used-up daily limit or a network
    failure comes back as `problem`, with stale or "unavailable" days, still
    200.
  - The response carries each place's `zone`, so sunrise and sunset show in
    local time. Icons are lucide icons rather than OWM's images, so they work
    offline.
- **Currency (52).**
  - The files live in `features/currency/` (the plan said `features/tools/`),
    following the one-slice-per-feature rule.
  - Amounts are formatted as US English on purpose ("¥", "NT$", "$"). A
    phone set to another locale could otherwise show "US$", or a bare "$"
    for NT$.
  - TWD shows cents, as `Intl` does by default.
- **Countdown (53).** The countdown shows on any card whose first day hasn't
  begun on the phone's clock. For the first ~14 hours after midnight in
  Tokyo, that includes a trip already listed under "Active", which goes by
  the trip's own zone.

**Before relying on it (Julian):**
- **Deploy 46–53 together.** The old app's Share dialog shows the trip id as
  the view code, and the trip id no longer lets new people join. Fly runs
  migrations 0007 and 0008 on start.
- **If PriPri joined the real trip as a viewer,** they need to rejoin with
  the **edit code** to see private memories and write new ones. All
  existing memories are now private.
- `fly secrets set OPENWEATHER_API_KEY=…`, with the One Call by Call
  subscription and a 1,000-a-day cap.
- The Pi: format and mount the drive, `make pi-backup-install`, fill in
  `/etc/pripri-backup.env`, `make pi-backup-run` (README, "Photo backup to
  the Pi").
- At 375 px: the Share dialog's two codes, a public memory as the seed
  viewer, the Weather and Currency pages from the drawer.

### Open questions (Run stage 10)

Public and private memories:

- **Q-P1. Who can make a memory public?**
  - (a) Only its author (today only the author edits a memory).
  - (b) Any editor, so either of you can share the other's entry.
  - Recommendation: **(a)**. It keeps "only the author changes a memory", and
    nobody's private note gets shared by someone else.
  - **Answer:** as recommended (2026-10-05).
- **Q-P2. Can viewers still write memories?** Today every member can.
  - (a) No: viewers get a read-only feed of public entries.
  - (b) Yes, and theirs are always visible to everyone.
  - Recommendation: **(a)**. The journal is yours; the in-laws follow along.
  - **Answer:** as recommended (2026-10-05).
- **Q-P3. Should viewers see confirmation numbers?** Q-S4 said yes when the
  only viewer was a traveler. With in-laws, those numbers (and a forwarded
  link) are enough to change a booking.
  - Recommendation: **hide them from viewers**, server-side. Notes, times and
    places stay. You two are editors, so you still see everything.
  - **Answer:** as recommended (2026-10-05).
- **Q-P4. The viewer code is the trip id,** which is in every trip URL. Anyone
  who sees a link or screenshot can join and read the plan, and it can't be
  revoked (only each person removed).
  - (a) Keep it; remove strangers from the Share dialog if they appear.
  - (b) A random view code, renewable like the edit code. People already on
    the trip stay.
  - Recommendation: **(b)** now that it's shared beyond the two of you. It
    reuses the edit code's machinery, so it's small.
  - **Answer:** as recommended (2026-10-05).

Photo backup:

- **Q-B1. How does the Pi sign in?**
  - (a) A superuser account (the backup endpoints live under `/admin`, per the
    template's convention). Its password sits in a root-only file on the Pi.
  - (b) A separate backup token (a Fly secret) that only opens the backup
    endpoints, so the Pi never holds an account password.
  - Recommendation: **(a)**, with a dedicated superuser account for the Pi
    (e.g. `backup@…`) so it can be disabled without touching yours. (b) is
    tighter but adds a second auth path to maintain.
  - **Answer:** as recommended (2026-10-05).
- **Q-B2. What gets backed up?**
  - (a) Photo originals only.
  - (b) Originals plus each trip's `journal.json` (memory text, times,
    places, which photos belong to which memory).
  - Recommendation: **(b)**. The trip export is plan-only, so this is the only
    off-Fly copy of what you wrote. It's a few hundred KB.
  - **Answer:** as recommended (2026-10-05).
- **Q-B3. A photo deleted in the app:** keep it on the drive (recommended: a
  backup, not a mirror) or delete it there too?
  - **Answer:** as recommended (2026-10-05).
- **Q-B4. The folder layout:** `<trip>/<date>/<time>_<author>_<id>.jpg`
  (recommended, browsable by day) or one flat folder per trip?
  - **Answer:** as recommended (2026-10-05).
- **Q-B5. The drive and the Pi.**
  - Is this machine (a Pi 5, where this session runs) the backup Pi?
  - How is the drive formatted? (a) **exFAT**: plug it into any Mac or PC to
    look through the photos; (b) **ext4**: Linux-native, sturdier on power
    loss, but a Mac/PC can't read it without extra software.
  - Recommendation: keep **exFAT** if that's what it is (likely, out of the
    box) so you can plug it in anywhere; ext4 only if it never leaves the Pi.
  - **Answer:** a Raspberry Pi 5; the drive is dedicated to the backup and can
    be formatted as needed (2026-10-05). **Resolved:** **ext4** (it never
    leaves the Pi). The install script works on any Pi, this one or another.

Weather:

- **Q-W1. Which OpenWeatherMap plan?**
  - (a) **One Call 3.0** ("One Call by Call"): needs a card on file, the first
    1,000 calls a day are free, and you can set a daily cap of 1,000 in OWM's
    dashboard so it can never charge. Gives current, 8 days daily, alerts, and
    the long-range daily outlook, so every trip day shows something weeks
    ahead.
  - (b) **The free key only:** current weather and 5 days of forecast (in
    3-hour steps). Trip days more than 5 days out show "Forecast from <date>".
    Before the trip, nothing for its days until 5 days before.
  - Recommendation: **(a)**, with the 1,000 cap. "As many days as possible" and
    "works ahead of the trip" both need it. We'd use about 25 calls a day.
  - **Answer:** as recommended (2026-10-05).
- **Q-W2. Which place is a day's weather?**
  - (a) One per day: where you sleep that night, else the travel day's
    arrival, else the previous day's.
  - (b) Every place with coordinates on the day.
  - Recommendation: **(a)**. Your places on one island are a few km apart;
    the overnight place is what matters, and it's one line per day.
  - **Answer:** as recommended (2026-10-05).
- **Q-W3. "Today's weather" before and after the trip?**
  - Recommendation: before, current conditions at the trip's first place
    ("Naha right now"); during, today's place; after, not shown.
  - **Answer:** as recommended (2026-10-05).
- **Q-W4. Units?**
  - Recommendation: **°F and mph**, with °C shown small beside the high/low.
  - **Answer:** as recommended (2026-10-05).
- **Q-W5. A scheduled daily refresh, or refresh on request only?**
  - Recommendation: **on request only** (your 12-hour rule). It covers "once a
    day" whenever anyone looks, and makes no calls when nobody does. A daily
    job could be added later if the first load after a quiet day feels slow
    (it should take a second or two).
  - **Answer:** as recommended (2026-10-05).

Currency:

- **Q-C1. Device or server caching?**
  - (a) **Device only:** the phone calls Frankfurter directly and keeps the
    rate for 12 hours (and offline).
  - (b) Server cache, like weather.
  - Recommendation: **(a)**. Frankfurter needs no key and allows browser calls,
    and the phone must keep the rate anyway for offline use. A server cache
    adds a table and an endpoint for no gain.
  - **Answer:** as recommended (2026-10-05).
- **Q-C2. Which currencies does a trip have?**
  - (a) Worked out from the trip's places (Okinawa & Taipei → JPY and TWD),
    with an "Other…" picker.
  - (b) A currency field you set on the trip (a trip document change).
  - Recommendation: **(a)**: nothing to enter, and it follows the itinerary.
  - **Answer:** as recommended (2026-10-05).
- **Q-C3. Calculator direction:** local → USD as asked, plus a swap button for
  USD → local (recommended, it's a few lines), or strictly one way?
  - **Answer:** as recommended (2026-10-05).

Pages, countdown, order:

- **Q-N1. Weather and Currency in the drawer only while a trip is open?**
  Recommendation: **yes**; both need a trip to know the places. (The
  alternative is "your current or next trip" from anywhere.)
  - **Answer:** as recommended (2026-10-05).
- **Q-D1. Midnight on which clock?**
  - (a) **The phone's** (as asked): 12:00 AM Oct 29 in Chicago, 30 minutes
    before the 12:30 AM flight.
  - (b) The trip's zone: midnight Oct 29 in Tokyo is 10 AM Oct 28 in Chicago,
    so it reaches zero a day early.
  - (c) The first booked departure ("boarding in 3 hours").
  - Recommendation: **(a)**.
  - **Answer:** as recommended (2026-10-05).
- **Q-D2. Rounding:** whole units rounded down: 2 days 23 hours reads "2
  days", 47 hours reads "1 day", 23 h 59 m reads "23 hours", and under a
  minute reads "Starting now". Recommendation: as described.
  - **Answer:** as recommended (2026-10-05).
- **Q-O1. Order:** public memories → backup → weather → currency → countdown?
  - **Answer:** as recommended (2026-10-05).
