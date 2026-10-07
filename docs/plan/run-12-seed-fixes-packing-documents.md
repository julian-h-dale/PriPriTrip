# Run stage 12 — seed accounts, small fixes, map zoom, packing lists, documents

Asked 2026-10-05 (Julian):
- **Forced change:** don't make people re-type the temporary password.
- **Countdown:** on the right of the trip card, so it stands out.
- **Backup tool:** a really easy way to test it locally.
- **Packing lists:** checklists in a few lists (clothes, electronics,
  toiletries, …).
- **Travel legs:** show the duration.
- **Map:** filtering to a day (or a "what" filter) pans and zooms to what's
  left, even if that spans countries.
- **Documents:** a drawer feature, editors only. Upload files to Fly, versioned;
  before the trip, download the latest version of each as one zip, as a hard
  copy fallback. Not cached in the app.
- **Seed data:** new accounts and the Okinawa trip in the seed. Withdrawn
  2026-10-06: the seed stays as it is.

**Decisions (answered 2026-10-06):** the seed doesn't change; every other
recommendation taken (Q-B1, Q-B4–Q-B7). The backup tool's simplification is
answered: keep it as it is (Q-B8).

**Change (2026-10-06, Julian): documents aren't versioned.** Upload a file,
and upload again to replace it. They're uploaded before a trip and only
downloaded during it. Item 8 below is the unversioned design.

### Where we are

- **The forced change** (`ForcedPasswordChange.jsx` → `ChangePasswordForm`)
  asks for the current password, and `POST /auth/change-password` requires it.
  The person typed it seconds earlier on the login screen.
- **The countdown** is a line in the middle of the card's text column
  (`TripsPage.jsx`, `TripCard`), between the dates and the stay/leg counts.
- **The backup script** (`scripts/pi-backup/pripri_backup.py`) reads its
  settings from the environment and already has `BACKUP_REQUIRE_MOUNT=0`, so
  it can run on any machine against the local API. Nothing documents that,
  and the seed trips have no photos to back up.
- **Travel** stores wall-clock `depart`/`arrive`; the zones come from the
  places (`zones.depart_zone`/`arrive_zone`). So a duration can be computed on
  read, across time zones, without storing anything.
- **The map** fits its bounds once, on load, to stays and activities (not
  travel endpoints). Changing a filter only hides markers; the view stays put.
- **"Versioning" today** (`services/versions.py`) is optimistic concurrency
  (If-Match, 409 on a stale edit), not a file history. Documents need their
  own version rows; the If-Match check can still guard rename/delete.
- **Files:** photos live on the Fly volume behind `PhotoStore`
  (`/data/photos`). nginx caps a request at 26 MB, the VM has 512 MB (the
  photo OOM fix, Run stage 5), and photos are served without login.
- **The seed** makes `user@` (owns Bern + Athens), `admin@` and `pripri@`
  (viewer on both). The API tests, the UI tests and the e2e suite (23 specs)
  sign in as these. `make seed-remote` **replants** the seeded trips on Fly,
  deleting their memories and photos.

### Design (assuming the recommended answers)

**1. Forced change without re-typing (Q-B1).** The login form passes the
password it just sent to the forced-change screen, in memory only (Redux,
never storage, cleared once used or on sign out). The form then hides the
"current password" field and sends it itself. If the app was reopened later
(no password in memory), the field shows as today. No API change, so an old
session after an admin reset still can't set a password without knowing the
temporary one.

**2. Countdown on the right.** The card's right column (where ⋯ is) gets the
countdown stacked: the number large (`23`), the unit small (`days to go`), in
`text-primary`, right-aligned, with ⋯ above it. The line in the middle goes.
"Starting now" fits the same slot. At 375 px the name still wraps in the
left column.

**3. The backup tool (Q-B8).** Open: see the question.

**4. Seed.** Unchanged (withdrawn).

**5. Travel duration (Q-B6).** The travel read schema gains
`durationMinutes` (null without an arrival), computed in the service from
the wall-clock times and their zones. Shown on the timeline's travel row
after the times (`2h 35m`, `13h 50m`; days only past 24 h: `1d 2h`) and in
the details sheet. Not stored, not in the trip document.

**6. Map zooms to the filters (Q-B7).** Whenever the day or "what" filter
changes, the map fits to the markers left: two or more → `fitBounds` with
padding; one → centre on it at zoom 14; none → stay put. With a day filter,
travel endpoints count (a flight day spans the flight, as asked). With no
filter, it returns to the trip's initial fit (stays and activities). A pure
`boundsFor(markers, filters)` helper carries the logic, so it's testable
without Google. Panning by hand isn't overridden until the next filter
change.

**7. Packing lists (Q-B4).**
- **Data:** `packing_items` (UUID, `trip_id`, `user_id` (whose list),
  `category`, `text`, `checked`, `position`, soft delete). Migration 0010.
  A list is a category; no separate table.
- **Per person, per trip:** each member, viewers included, has their own lists
  (PriPri and Julian pack different bags). Others can't see them (404).
- **Categories:** Clothes, Toiletries, Electronics, Documents & money,
  Health & meds, Beach & outdoors, Carry-on, Other. Empty ones collapse.
- **Starter items:** "Start from suggestions" fills a few per category
  (passport, chargers, plug adapter, sunscreen, …), each deletable. Shown
  only while your list is empty.
- **API:** `GET/POST /trips/{id}/packing`, `PATCH/DELETE
  /trips/{id}/packing/{item}`, `POST /trips/{id}/packing/suggestions`.
  Single-owner rows, so no If-Match.
- **UI:** "Packing" in the drawer's Trip tools (`ToolLayout`). Lists as
  sections with a count (`7/12`), tap to check, add a line per section, ⋯ to
  rename/delete. Checks are optimistic, with a toast on failure. A "Hide
  packed" switch. Online only for now (packing happens at home).

**8. Documents (Q-B5, no versions).**
- **Data:** `trip_documents` (UUID, `trip_id`, `name`, `filename`,
  `content_type`, `size`, `uploaded_by`, `created_at`, `updated_at`, soft
  delete). Migration 0011.
- **Files:** a `DocumentStore` like `PhotoStore`, at `DOCUMENT_DIR`
  (`/data/documents` on Fly), one file per document:
  `<trip>/<document>`. Replacing writes a temp file and renames it over the
  old one. Never served without sign-in.
- **Who:** the owner and editors (`get_editable_trip`: a viewer gets 403, as
  on every other editor-only route, and no drawer item).
- **API:**
  - `GET /trips/{id}/documents`: the list, A to Z.
  - `POST /trips/{id}/documents` (multipart: file, optional name) adds one.
  - `PUT /trips/{id}/documents/{doc}/file` (file) replaces its file.
  - `PATCH /trips/{id}/documents/{doc}` renames it; `DELETE` soft-deletes it.
  - `GET /trips/{id}/documents/{doc}/file` downloads one.
  - `GET /trips/{id}/documents.zip`: every live document, named
    `<name>.<ext>` (duplicates numbered), built in a temp file
    (`ZIP_STORED`) and streamed.
  - 25 MB per file. PDFs, images, Word/Excel/PowerPoint, text and CSV;
    anything else is 415.
  - Last write wins (no If-Match): two people rarely replace the same
    passport scan at once.
- **UI:** "Documents" in Trip tools for the owner and editors. A list (name,
  type, size, when and by whom). Add (file picker), and per document ⋯:
  Download, Replace, Rename, Delete (confirm). "Download all (zip)" fetches
  through `apiClient` and saves the blob as `<trip name> documents.zip`.
  Nothing is cached offline.

### Phases

- **Phase 56 — forced change without re-typing, countdown on the right,
  travel duration.**
  - **Scope:** items 1, 2 and 5 (API: `durationMinutes`; UI: three changes).
  - **Tests:** the forced form after login has no current-password field and
    succeeds; after a reload it asks for it; the password never reaches
    storage; the countdown renders in the right column (and not for
    started trips); `durationMinutes` across zones (Chicago → Tokyo), with no
    arrival (null), and overnight; formatting (`45m`, `2h 5m`, `1d 2h`).
  - **E2E:** forced change in `accounts.spec.js` without the current
    password. Screenshots at 375 px: trips list, travel row.
  - ✅ (2026-10-06). Built as planned. The password is held in a module
    variable in `authSlice.js`, never in Redux or storage, and dropped when
    `/users/me` says no change is needed, after the change, and on sign-out.
    The duration is converted through UTC (a same-zone subtraction in Python
    ignores a DST change, which a test caught). Screenshots `01`, `03` and `42`.
- **Phase 57 — the map follows the filters.**
  - **Scope:** item 6.
  - **Tests:** `boundsFor` (none, one, many; travel counted only with a day;
    no filter = the initial fit); MapPage calls `fitBounds`/`setZoom` on
    filter change and not on a re-render.
  - **E2E:** on the seeded Athens trip, pick the Chicago → Athens travel day, then an Athens day; screenshots.
  - ✅ (2026-10-06). `viewFor` (in `mapFilters.js`) sets the first view
    and every filter change: fit with 48 px padding, or centre at zoom 14
    for one place; nothing left leaves the view alone; panning, pins and
    trip reloads never re-fit. **One change to the day filter:** both ends
    of a travel leg now match every day it travels on (`legDays`), so an
    overnight flight shows whole on either day; before, the arrival airport
    belonged only to the arrival day. The e2e runs on the Bern sample (the
    Athens trip moves with today's date): the May 10 overnight flight shows
    Chicago and Zürich; screenshots `09a`, `09b`.
- **Phase 58 — packing lists (API).** Migration 0010, model, service,
  router, suggestions. **Tests:** CRUD; someone else's list is 404; a viewer
  can keep their own list; suggestions only fill an empty list; soft delete.
- **Phase 59 — packing lists (UI).** Slice, page, drawer item. **Tests:**
  check/uncheck (optimistic, rolled back on failure), add, rename, delete,
  Hide packed, suggestions; 375 px by eye.
  - ✅ Phases 58–59 (2026-10-06), as planned. A viewer keeps their own list
    too (the routes use `get_viewable_trip`; the line itself is checked by
    `get_own_packing_item` in `dependencies.py`). Writes are silent (no
    "Saved" toast per tick); a failed tick flips back and shows the error.
    The page heads "Packing" with "n of m packed" and Hide packed; lists not
    started show as buttons under "More lists". E2E `packing.spec.js`;
    screenshots `50`–`51`.
- **Phase 60 — documents (API).** Migration 0011, model, store, router,
  zip. **Tests:** upload; replace swaps the file; the zip holds every live
  document with duplicate names numbered; viewers 403 on every route,
  strangers 404, anonymous 401; 25 MB and type limits; rename; a deleted
  document is left out of the list and zip.
- **Phase 61 — documents (UI).** Slice, page, drawer item for editors.
  **Tests:** hidden for viewers; upload / replace / rename / delete; Download all calls the zip endpoint and saves a blob. **E2E +
  by hand:** download the zip on a real iPhone and open it in Files.

  - ✅ Phases 60–61 (2026-10-06), as planned (unversioned). Viewers get
    403 on every route, like any other editing route, and no drawer item
    (the drawer reads the open trip's role). Downloads go through
    `apiClient` (so the sign-in header is sent) and then `saveToPhone`: the
    share sheet where the phone has one (iOS: Save to Files), else a plain
    download. Files are sent as `filename*=utf-8''…`. A deleted document's
    file stays on disk. E2E `documents.spec.js` (adds a PDF, checks it's in
    the zip, deletes it); screenshot `52`.
  - **Before relying on it (Julian):** deploy. Fly runs migrations 0010 and
    0011 on start; `DOCUMENT_DIR=/data/documents` is in `fly.toml`. Then
    download the zip once on the iPhone and open it in Files.

- **Follow-ups (2026-10-06, Julian) ✅:**
  - **Packing quantities** (migration 0012, default 1, 1–99): set when
    adding (a "how many" box beside the text) or with ⋯ → Edit, and shown as
    "×3". Suggestions come with clothes counts for about a week.
  - **Deleting a whole list:** ⋯ on a list's header → Delete list (asks
    first, `DELETE /trips/{id}/packing/lists/{category}`, only your lines).
    An empty list just closes. Deleting one line was already under the
    line's ⋯.
  - **Tool pages get ← in ☰'s place** (`TopBar back=…`): back to the screen
    you came from, or to the trip when opened directly. The old ← on the
    right is gone.

- **Time zones (2026-10-06, Julian) ✅:** a trip tool with a live digital
  clock (to the second) for every zone the trip passes through, in the
  order the trip reaches it, each named by up to two of its places ("Naha ·
  Onna · +1"). Built on the phone from the zones the read model already
  gives every time (travel ends, stays, activities), so it agrees with the
  timeline and works offline. Each clock shows the date there, day or night,
  its UTC offset, and how far ahead or behind the phone it is. The zone the
  phone is in says "You're here"; away from all of them, the phone gets its
  own clock first. 12-hour, like the rest of the app. Screenshot `35`.

### Open questions (Run stage 12)

- **Q-B1. Skipping the temporary password: how?**
  - (a) The app remembers what was typed at login (memory only) and fills
    it in. No server change. After a reopen, it asks.
  - (b) The server stops asking for the current password while the flag is
    set. Simpler, but it undoes a Phase 54 guarantee: whoever holds an old
    session (the lost phone that prompted the reset) could set the password
    without knowing the temporary one, and take the account.
  - Recommendation: **(a)**.
  - **Answer:** as recommended, (a) (2026-10-06).
- **Q-B2. The seed accounts.**
  - (a) Keep `user@`/`admin@` and the Bern trip as test fixtures (the API
    tests and e2e suite depend on them), as in the table. Replace `pripri@`
    with `viewer@`.
  - (b) Retire them and move the tests onto Julian/gabrom/viewer. Real
    emails in test fixtures, and rewriting most of the e2e suite.
  - Recommendation: **(a)**. Also: gabrom's display name? (I'll use
    "Gabrom" unless you say otherwise.) Should viewer@ also see Bern? (yes,
    so the e2e viewer specs keep working.)
  - **Answer:** withdrawn: no seed changes (2026-10-06).
- **Q-B3. Seeding Fly, and forcing a change.**
  - Okinawa on Fly: import only if missing, never replant (recommended), or
    leave Okinawa out of `seed-remote` entirely?
  - Should gabrom's account start with the "must change password" flag (so
    they choose their own on first sign-in)? Recommendation: **yes for
    gabrom, no for Julian and viewer@** (you'd be forced again after every
    `make reset-db`).
  - Does a `julian.h.dale@gmail.com` account already exist on Fly? If so,
    the seed leaves its password alone; if your existing Okinawa trip there
    has a different name, the seed would add a second copy, so it might be
    better to skip `seed-remote` for this.
  - **Answer:** withdrawn: no seed changes (2026-10-06).
- **Q-B4. Packing lists.**
  - (a) Per person per trip (recommended), (b) one shared list per trip,
    (c) both: your own lists plus a "Shared" list everyone ticks.
  - The categories above: OK, or add/remove (e.g. Snorkel gear, Kids,
    Gifts)? Can you add your own lists?
  - Starter suggestions: yes (recommended), or always start empty?
  - Carry over: copy last trip's list (later), or not needed?
  - **Answer:** as recommended (2026-10-06).
- **Q-B5. Documents.**
  - a. Editors and the owner only; viewers don't see it at all? (recommended)
  - b. 25 MB per file; PDFs, images, Word/Excel/text. Enough?
  - c. Old versions downloadable one at a time (recommended), or only kept
    on the server?
  - d. Delete: soft (recommended), so an accidental delete can be undone
    from the database.
  - e. Back documents up to the Pi as well? Recommendation: later, as a
    small follow-up to the backup script.
  - f. These may be passports and tickets. Fly volumes are encrypted at rest
    and every route needs sign-in and editor; anything more (e.g. a
    separate passphrase) is out of scope unless you want it.
  - **Answer:** as recommended (2026-10-06).
- **Q-B6. Travel duration.** Computed, not stored or editable;
  shown on the timeline row and in the details. OK? (Flights with no
  arrival time just show none.)
  - **Answer:** as recommended (2026-10-06).
- **Q-B7. Map.** Fit to the filtered markers on every filter change,
  including travel endpoints when a day is picked; clearing goes back to the
  trip fit. OK?
  - **Answer:** as recommended (2026-10-06).

- **Q-B8. The backup tool, simpler.** Today it's five files: the Python
  script, `install.sh`, a systemd `.service` and `.timer`, and an
  `.env.example`. The script is the only one that does the backup; the rest
  install it to run every 30 minutes as a sandboxed system service.
  - (a) Keep it as it is, and only add `make pi-backup-local` and a README
    "Try it locally".
  - (b) Shrink it: the script reads its settings from a file next to itself
    (`scripts/pi-backup/backup.env`, gitignored), so it's just `python3
    pripri_backup.py` anywhere, and one `crontab -e` line runs it every 30
    minutes, logging to a file. `install.sh`, the `.service` and the `.timer`
    go. You lose the systemd sandbox (read-only except the drive), the
    catch-up run after the Pi was off, and `journalctl`; the drive-mounted
    check stays.
  - Recommendation: **(b)** for a two-person setup, unless it's already
    installed on the Pi and working, in which case (a).
  - **Answer:** (a), keep it as it is (2026-10-06).
