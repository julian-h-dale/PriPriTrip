# Run stage 4 — the journal, offline and in place: offline memories, location, photos

Asked 2026-10-03 (Julian):
- **Offline first:** write memories with no signal. The phone's clock is
  trusted (NTP, re-synced when you land), so the device stamps the time
  when you tap Save. Add a server-side "created on" field anyway, in case
  it's needed later.
- **Location:** ask for the user's location and attach it to a memory.
  Also the blue "you are here" dot on the map.
- **Photos:** from the gallery or the camera, stored on a Fly volume as an
  attached file store, not as base64 in the database.

**Decisions** (answered 2026-10-03: "go with your recommendations", plus
Julian's notes on storage and photo quality). Built on the
`journal-memories` worktree and branch, stacked on `rebuild`, which is
being deployed to Fly separately.
- The phone's time orders the journal. The server's `received_at` is kept
  as "created on". A device time more than 10 minutes in the future is
  clamped, not rejected.
- Offline: new memories, edits and deletes all queue.
- Location is on by default once allowed, with a per-memory chip to remove
  it. It's asked for when the first memory is saved, and shown as the
  nearest trip place within about 250 m, else a map link. Memories become
  their own pins on the map, with a toggle.
- **Photos are stored on a Fly volume, grown to about 10 GB.**
  - **Full quality is kept:** the original as uploaded, plus a 2560 px
    display copy and a 480 px thumbnail made by the **server**.
  - At most 10 per memory and about 25 MB each. Memories only.
- **Photo URLs are unguessable rather than signed.** Each URL contains the
  photo's random UUID and is served without a login check. That's the same
  risk Julian accepted for joining by trip id, and it makes caching trivial.
  Signed URLs can be added later without changing storage.
- **Offline:** thumbnails are always cached, and display copies once
  viewed, up to a cap. Originals only online.
- **Backups:** Fly's daily snapshots for now. An off-site copy (for example
  a nightly pull to the Pi) comes before relying on it for a real trip.

### Design

**1. Offline memories: an outbox.** The complexity isn't the timestamp,
which is easy. It's making a write that happens with no server reliable
later.
- **The phone makes the ids.** A memory's `id` (a UUID) and `createdAt` (UTC
  ISO, from `Date.now()` at Save) are made on the phone and sent with it.
  The server treats `POST` with an existing id as "already have it": same
  response, no duplicate. So a retry after a dropped connection (did it
  save or not?) can never create two.
- **The outbox:** an IndexedDB store of pending operations (`create`,
  `update`, `delete`), per user.
  - A new memory shows in the journal **at once**, marked "Waiting to sync".
  - Editing or deleting a not-yet-synced memory rewrites its outbox entry
    instead of queueing a second operation.
  - Only the author edits, so there are no conflicts to merge. The last
    write per memory wins.
- **When it sends:**
  - when the phone comes back online;
  - when the app opens or comes to the foreground;
  - after each new save;
  - on a back-off retry.

  It doesn't use Background Sync, which iOS doesn't support, so sending
  happens while the app is open. That's fine for "the second they land".
- **Expired login:** a 401 while sending keeps the outbox. After signing
  in, it sends. **Sign out** with pending memories warns first ("2
  memories haven't synced. Sign out anyway?").
- **Server:**
  - `created_at` becomes **the device's** time and stays the ordering key.
  - A new `received_at` is the server's own UTC stamp (your "created on",
    kept just in case).
  - A device time more than 10 minutes in the future is **clamped to
    `received_at`** rather than rejected. A rejection would leave a memory
    stuck in the outbox forever.
  - Ties are broken by `id`, as now.
- **Ordering caveat (accepted):** two phones with clocks a few seconds apart
  can interleave slightly. That's fine for a journal.

**2. Location.**
- **The API:** `navigator.geolocation` (the browser's built-in location).
  - It needs **HTTPS**; `localhost` is fine for development.
  - The browser asks permission once, and an installed iOS app may ask
    again occasionally.
  - **GPS works with no signal.** It's slower to get a first fix without
    data, but it works.
- **When to ask:** the first time someone saves a memory, not when the app
  opens. Asked in context, people say yes.
  - Saving **never waits** on location: it waits up to about 8 seconds,
    accepts a reading up to a minute old, and saves without one if location
    is denied or too slow.
  - The memory dialog shows a removable 📍 chip ("Near Kornhauskeller" or
    "Location attached"), so a single memory can go without.
- **Stored** on the memory: `lat`, `lng` and `accuracy` (in metres).
- **Shown as the nearest place on the trip** within about 250 m ("near
  Hotel Goldener Schlüssel"). That works offline and is free. Otherwise
  it's a "Show on map" link. Google reverse geocoding (turning coordinates
  into a street or place name) could come later.
- **The blue dot:** `watchPosition` while the map is open, an Advanced
  Marker dot, and an **accuracy circle**, which is honest about uncertainty
  (your earlier concern about misleading information). A "center on me"
  button. It stops watching when you leave the map. No distances and no
  routing; Directions still hands off to the maps app.

**3. Photos.**
- **Getting photos from the phone is easier on the web than you'd think.**
  - **No camera code.** A plain `<input type="file" accept="image/*"
    multiple>` makes the phone show its own menu:
    - on iOS, "Photo Library / Take Photo / Choose File";
    - on Android, the camera and gallery apps.
  - The operating system runs the camera and the gallery; we only receive
    the file(s).
  - **No permission prompt:** the user picking files *is* the permission.
  - `capture="environment"` would skip the menu and open the back camera
    directly. Useful as a second "Take photo" button, but optional.
  - The in-page camera (`getUserMedia`, a live viewfinder inside the app)
    is a different, harder thing. It needs a camera permission and our own
    shutter UI, and we don't need it.
- **Quality: the original is kept** (Julian, 2026-10-03: quality over
  storage, and 5–10 GB is fine).
  - The phone uploads the photo as picked. iPhone HEIC photos arrive as
    high-quality JPEG through the picker.
  - The **server** (Pillow, one photo at a time so the 512 MB machine copes)
    makes:
    - a **2560 px display copy**, JPEG quality ~85 (about 0.6–1 MB): what
      the journal shows full screen;
    - a **480 px thumbnail**.
  - Both copies are rotated correctly and have **their EXIF stripped**,
    including GPS.
  - The original keeps its EXIF. It's only ever downloaded deliberately
    ("Download original"), or loaded when zooming in.
  - About 3–6 MB per photo: 10 GB holds about 2,000 photos with their
    copies, roughly $1.50/month.
- **Storage: a Fly volume, agreed**, with a small `PhotoStore` interface (a
  local-disk version now) so moving to object storage later (Tigris on Fly,
  S3-compatible) is a swap, not a rewrite.
  - Files live under `/data/photos/<trip>/<photo id>/original.<ext>`,
    `display.jpg` and `thumb.jpg`.
  - A `photos` table holds the metadata: id, memory id, trip id, author,
    width, height, size, and when it was created and received. Soft delete.
- **Why not base64 in the database:**
  - it's about 33% bigger;
  - the SQLite file grows, and so does every backup and every copy;
  - photos would ride along in trip and journal JSON (memory, and the
    offline cache);
  - and there's no streaming or browser caching.

  Files on disk, metadata in the database, is the standard split.
- **Volume facts to plan around:**
  - The volume is attached to **one machine**. The app already runs a
    single machine, so that's fine. Scaling to two machines would mean
    moving to object storage (hence the interface).
  - Fly takes **daily snapshots, kept 5 days**, which cover the photos too.
  - Grow it from 1 GB to **~10 GB** with `fly volumes extend` before photos
    go live. That's about $0.15 per GB per month; Fly's snapshots may cost
    a little extra.
- **Serving:** an `<img>` tag can't send our login token (it's a header).
  So photos are served at **unguessable URLs**:
  - `GET /photos/{photo uuid}/{display|thumb|original}`, with no login
    check;
  - the random UUID is the secret, as with joining by trip id;
  - `Cache-Control: private, max-age=31536000, immutable`.

  Deleting the photo kills its URL. Signed short-lived URLs can be added
  later without touching storage.
- **Upload:** `POST /trips/{id}/memories/{memoryId}/photos` (multipart), by
  the memory's author.
  - Content type and size are checked (JPEG, PNG, WebP or HEIC, at most
    25 MB), and the image is re-decoded on the server with Pillow, so only
    real images get stored.
  - nginx's `client_max_body_size` (1 MB by default) goes up to 26 MB.
- **Offline:**
  - The **outbox holds the photo files too**, in IndexedDB. Uploads happen
    after the memory itself has synced. An installed app's storage isn't
    evicted.
  - **Thumbnails** of the journal are always cached for offline viewing,
    and display copies once viewed, up to a size cap (a service-worker
    runtime cache). Originals load only when online.
  - The outbox holds the original until it uploads, so an offline-queued
    photo takes its full size on the phone until then.
- **Viewing:** a strip of thumbnails on each memory. Tapping one opens it
  full screen, with swipe between photos.

### Phases

- **Phase 29 — memories made on the phone (API).** ✅
  - The client sends `id` and `createdAt`. `POST` with an existing id
    returns the same memory, so there are no duplicates.
  - `received_at` is added. A future time is clamped.
  - Edit and delete are unchanged.
  - **Tests:** a retry is idempotent, ordering follows the device time, the
    clamp, and another user's id gives 409.
- **Phase 29a — Alembic.** ✅ (Julian, 2026-10-03: "bring in Alembic; assume
  a deployed app after the rebuild work"; its own phase and commit.)
  - `api/alembic.ini` and `api/migrations/`, with an async `env.py` and batch
    mode for SQLite.
  - **0001 is the baseline:** the schema exactly as deployed from `rebuild`,
    autogenerated from those models.
  - **0002 adds `memories.received_at`** and backfills it from `created_at`
    (before Phase 29, that was the server's stamp).
  - `app/migrate.py` upgrades to head. A database from before Alembic is
    stamped at 0001 first, keeping its data.
  - `deploy/start.sh`, `api/dev.sh` and the seed run it. The app no longer
    calls `create_all`. The Dockerfile now copies the migrations.
  - **Fixed in passing:** `make reset-db` hardcoded `api/data/app.db`, so it
    never reset a worktree's database. It now deletes whichever file
    `DATABASE_URL` names.
  - **Tests:**
    - migrating to head gives exactly the models' schema (this catches
      model drift);
    - a pre-Alembic database is stamped, upgraded and keeps its data, with
      `received_at` backfilled;
    - migrating is idempotent, and a downgrade round-trips.
  - **Also checked by hand:** a database made by the real `rebuild` checkout
    (seeded, with a shared trip) migrated cleanly to 0002, with no schema
    differences.
- **Phase 30 — the outbox (UI).** ✅
  - **Built as planned, plus:**
    - **Every write goes through the outbox, online or not:** one path, and
      the screen updates instantly.
    - **A sync requested while another is finishing runs again right
      after.** A real bug, found by the tests: "back online" could otherwise
      be ignored until the 30-second retry.
    - **The offline bar no longer says "read-only":** memories can be
      written offline. Trip edits stay visibly greyed.
    - **Playwright reads this checkout's own ports from `.env`,** so
      worktrees can be tested live.
    - **Live:** `e2e/journal-offline.spec.js` writes two memories offline,
      goes back online, and checks they're sent once each, in order. The
      full `trip.spec.js` also passes on the worktree (13 tests).
  - The IndexedDB outbox, "Waiting to sync", sending on reconnect, on
    foreground, after saving and on back-off.
  - Offline edits and deletes, a 401 keeping the outbox, and the sign-out
    warning.
  - **Tests:** an outbox unit test with fake IndexedDB, plus component
    tests.
  - **Live:** Playwright offline, write two memories, go online, and check
    they sync once, in order.
- **Phase 31 — location and the blue dot.** ✅
  - **Built as planned, plus:**
    - **Migration 0003** adds `memories.lat`, `lng` and `accuracy`.
    - **An edit can drop a memory's location** (`location: null`) **but
      never add one**, since it records where the phone was at writing.
    - **The blue dot starts on its own only if location is already
      allowed;** otherwise "Show where I am" asks. Opening the map never
      pops a prompt.
    - **Fixed: pressed map toggles were invisible.** House, Calendar and the
      new Memories toggle all had `bg-card` overriding the pressed fill.
      House had this since Phase 15.
    - **Fixed: the journal e2e test's cleanup.** It counted before the
      journal loaded, then closed before the outbox sent the delete. That
      left test memories in the worktree's and the main dev databases;
      those were removed.
    - **Live:** `e2e/journal-location.spec.js`, with a faked location next
      to the Bern hotel: "Near Hotel Goldener Schlüssel", the memory's pin,
      and the blue dot.
  - The permission flow, a location chip in the dialog, and
    `lat`/`lng`/`accuracy` on memories (API and UI).
  - The nearest-trip-place label, and the map's blue dot with its accuracy
    circle and "center on me".
  - **Tests:** a mocked geolocation for granted, denied and slow, and a
    unit test for the nearest place.
  - **Live:** Playwright can fake a location (`geolocation` plus
    permissions).
- **Phase 32 — the photo store (API).** ✅
  - **Built as planned, plus:**
    - **`pillow` and `pillow-heif`** (iPhone HEIC), migration 0004, and
      `PHOTO_DIR` (`/data/photos` on Fly, in `fly.toml`).
    - **The display copy and thumbnail keep the colour profile** (Display
      P3), with EXIF stripped. Small photos are never upscaled.
      Transparent PNGs are put on white.
    - **"Decompression bombs" are refused** (over 120 megapixels).
    - **Processing is serialized,** one photo at a time.
    - **An upload can carry its own `id`,** for the Phase 33 outbox: a retry
      gives 200 with the same photo.
    - **Deleting a photo** removes its files and stops its URLs.
      **Deleting a memory** stops its photos' URLs but keeps the files
      (soft delete); purging them is a possible later job.
    - **Live:** a 9 MB, 12-megapixel JPEG processed in under a second on
      the Pi. The nginx `client_max_body_size` change passed `nginx -t`.
  - The `photos` table, `PhotoStore` on disk, and upload with its checks.
  - Server-made display copies and thumbnails (Pillow; rotation; EXIF
    stripped from the copies).
  - Unguessable URLs, delete, and the nginx body size.
  - **Tests:**
    - a real JPEG upload, then each size fetched;
    - the display copy is 2560 px on its long edge with no EXIF, and the
      original keeps its EXIF;
    - a non-image or an oversized file is rejected;
    - only the author can upload or delete, and only members can list
      photos;
    - a deleted photo's URLs give 404.
- **Phase 33 — photos in the journal (UI).** ✅
  - **Built as planned, plus:**
    - **Outbox entries for photos** ("addPhoto" and "removePhoto"), keyed by
      their own id and queued after their memory. Photo bytes are stored as
      an ArrayBuffer; a `FileReader` fallback covers older Safari.
    - **Deleting a memory drops its unsent photos.** Removing a photo that
      hasn't uploaded yet sends nothing.
    - **Photos are cached by the service worker:** thumbnails kept
      (cache-first), display copies capped at 200, originals never cached.
    - **Fixed, found by the parallel e2e run:** a race between the journal's
      refresh and the outbox could make a just-synced memory vanish until
      the next refresh. A regression test is confirmed to fail without the
      fix.
    - **Fixed:** an edit's server reply could briefly bring back a photo
      whose removal was still queued.
    - **Live:** `e2e/journal-photos.spec.js` picks two photos offline, they
      upload on reconnect (201 each), and the viewer shows the display copy
      and then the original. The whole live suite (15 tests) passed twice
      in a row.
  - **Julian, on a real phone over HTTPS:** take a photo with the camera and
    pick one from the library. Neither can be faked in a headless browser.
  - "Add photos" (the gallery or camera menu), the thumbnail strip,
    full-screen viewing on the display copy (zooming in loads the
    original), "Download original", the offline outbox for photos, and
    cached thumbnails and viewed display copies.
  - **Tests:** the picker flow, outbox photos, and which size each view
    asks for.
  - **Live:** upload a fixture photo in Playwright.
  - **Julian:** on a real phone over HTTPS, take a photo with the camera and
    pick one from the gallery.

### Open questions (Run stage 4)

- **Q-4.1. Your message was cut off** ("I don't have a…"). Was there more?
  - **Answer:** no, a typo (2026-10-03).
- **Q-4.2. The device's time orders the journal, and the server's
  `received_at` is kept as "created on"?** A device time more than 10
  minutes in the future is clamped rather than rejected.
  - Recommendation: yes.
  - **Answer:** yes (2026-10-03).
- **Q-4.3. Offline edits and deletes too, or only new memories?**
  - Recommendation: all three. With only the author editing, there's
    nothing to conflict with.
  - **Answer:** yes, all three (2026-10-03).
- **Q-4.4. Location on by default once allowed, with a chip to remove it
  per memory?**
  - Recommendation: yes. Ask the first time a memory is saved.
  - **Answer:** yes (2026-10-03).
- **Q-4.5. How is a memory's location shown?**
  - Recommendation: the nearest trip place within about 250 m, else a "Show
    on map" link. Google reverse geocoding later if wanted.
  - **Answer:** recommended: the nearest trip place within about 250 m, else a map link (2026-10-03).
- **Q-4.6. Show memories on the map too, as their own pins?** It's cheap
  once they have a location.
  - Recommendation: yes, in Phase 31, with a filter toggle beside
    House/Calendar.
  - **Answer:** yes, with a toggle (2026-10-03).
- **Q-4.7. Photo limits.**
  - Recommendation: up to 10 per memory; shrunk to 2048 px with a 480 px
    thumbnail; **originals not kept** (storage, and their EXIF location
    data).
  - **Answer:** **revised:** keep originals for quality, plus a server-made 2560 px display copy and a 480 px thumbnail; at most 10 per memory, about 25 MB each; a ~10 GB volume (2026-10-03).
- **Q-4.8. Photos offline.**
  - Recommendation: cache thumbnails only. Full-size photos when online.
  - **Answer:** thumbnails always, display copies once viewed (capped), originals online only (2026-10-03).
- **Q-4.9. Photos only on memories, or also on a stay or activity?**
  - Recommendation: memories only for now.
  - **Answer:** memories only (2026-10-03).
- **Q-4.10. Backups.** Are Fly's daily volume snapshots (kept 5 days)
  enough for now, or should there be an off-site copy, given that photos
  can't be recreated?
  - Recommendation: snapshots for now. An off-site copy (Tigris, or a
    nightly copy) before relying on it for a real trip.
  - **Answer:** snapshots for now; an off-site copy before a real trip (2026-10-03).
