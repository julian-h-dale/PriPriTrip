# Run stage 24 — photos and memories are never dropped

Julian (2026-10-08), from testing on an iPhone: a photo taken with the
in-app camera (Take photo) was refused — "Only JPEG, PNG, WebP or HEIC
photos" — and then "A photo couldn't be uploaded and was dropped." The same
picture picked from the library uploads fine. Fix the refusal, and stop the
phone throwing away anything the server turns down.

**Status: complete** (Phases 88–90). Branch `photo-resilience`.

## Where we are

- **Why the camera photo is refused.** iPhone camera captures handed to
  `<input capture="environment">` are JPEGs carrying a second embedded
  image (the HDR gain map) in an MPF container. Pillow opens those as
  format `"MPO"`, not `"JPEG"`. `app/photos.py` maps only
  `JPEG / PNG / WEBP / HEIF` (`FORMATS`), so `process()` raises
  `InvalidPhoto("Only JPEG, PNG, WebP or HEIC photos")` → 422. Reproduced
  locally (2026-10-08): an MPO made with Pillow opens as `MPO` and is
  refused with that message. Library picks are re-encoded by iOS into a
  plain JPEG or HEIC first, which is why they work.
- **A second MPO trap.** `_display()` only decodes small (`draft`) when
  `img.format == "JPEG"`. `MpoImageFile` subclasses `JpegImageFile`, so
  `draft` works on it, but the check skips it: a 48 MP camera photo would
  be decoded full size (~145 MB) on the 512 MB machine.
- **Why the photo was then lost.** `syncOutbox` (`journalSlice.js`) treats
  every response except no-response, 401 and 5xx as "can never succeed":
  it deletes the entry from the outbox and toasts "…was dropped", then
  carries on with the next entry. A photo from Take photo isn't in the
  Camera Roll, so the outbox held its only copy.
- **Other 4xx that drop things today** (from the 2026-10-08 resilience
  review):
  - `403 PASSWORD_CHANGE_REQUIRED` after an admin password reset: every
    queued memory and photo for that person is dropped, one by one.
  - 403 / 404 after a role change to viewer or removal from the trip.
  - 422 on a memory → its photos then 404 → all dropped.
- **Phone storage.** `outbox.js` `safely()` swallows IndexedDB failures
  (e.g. quota), so `createMemory` can say "Saved on this phone" when
  nothing was saved. The app never asks for persistent storage
  (`navigator.storage.persist()`).
- Photos dropped in last night's test (Athens seed trip) are gone from the
  phone; there is nothing to recover.

## Design

### Server: accept iPhone camera photos (Q-P1)

- `FORMATS` gains `"MPO": "jpeg"`: it is a JPEG, stored as
  `original.jpeg` and served as `image/jpeg`, byte-for-byte as uploaded
  (gain map and EXIF intact). Nothing downstream changes: the Pi backup,
  `/photos/{id}/original` and the backfill all key off `"jpeg"`.
- `_display()` uses `draft` for both `JPEG` and `MPO`, so a camera photo
  is decoded small like any JPEG.
- The display copy and thumbnail are made from the first (main) image, as
  now, at standard brightness; the gain map is never decoded (Q-P2: no HDR
  work).

### Phone: the outbox never deletes what the server refused

Every response to an outbox write is one of three kinds:

| Kind | Responses | What happens |
|---|---|---|
| **Done** | 2xx | Removed from the outbox (as now). |
| **Later** | no response, 401, 403 `PASSWORD_CHANGE_REQUIRED`, 408, 429, 5xx | Kept; this pass stops; retried on the usual triggers (as now for 401/5xx). |
| **Stuck** | any other 4xx | **Kept**, marked `stuck: { status, message, at }`. Not retried automatically. The pass carries on with other memories. |

- **One memory's writes stay in order.** When a memory's create or update
  is stuck, its photos and later writes wait behind it (not sent, not
  dropped), so a refused memory can't cascade into 404'd photos.
- **Shown where it happened.** A stuck memory or photo shows on its
  journal row with a "Couldn't upload" badge and the server's message.
  Tapping it offers:
  - **Save to phone** (photos; `saveToPhone.js`, the share sheet), so the
    only copy can be rescued;
  - **Try again** (clears `stuck`, sends now — for after a fix is deployed);
  - **Remove** (asks first; the only way a stuck write is deleted).
- **Resync: stuck items can always be sent again.** A stuck item is an
  ordinary outbox entry carrying its last failure; it's only left out of
  the automatic 30-second retry (a 4xx would just be refused again until
  something changes). It's sent again:
  - **one item:** Try again, above;
  - **all of them:** "Try all again" on the journal's "couldn't upload"
    notice, and every tap of **Upload** (each stuck item once per tap);
  - **once, automatically, after the app updates** (a new version is when
    a fix arrives).
  A retry that works uploads as normal; one that's refused again stays
  stuck with the new message.
- **It stays on the memory on screen, too.** Today two things take a
  refused photo off its memory, and both change:
  - the `syncFailed` reducer removes the photo from the memory (and a
    refused create removes the whole memory). It marks them `stuck`
    instead;
  - `applyPending` (the outbox laid over the server's list on every
    load) draws stuck entries like pending ones, with `stuck` set, so the
    photo is still on the memory after a reload or a refresh from the
    server.
- **Deleting a memory asks first when it still holds photos on the phone.**
  Today a memory delete also deletes its queued photos, without a word. If
  any are waiting or stuck, the delete confirmation says "N photos on this
  memory haven't uploaded and will be deleted from this phone" and offers
  Save to phone first. Removing a stuck photo in the edit dialog is the
  same deliberate Remove, so it asks too.
- **Upload counts stuck photos separately.** "Upload stopped: N photos are
  still on this phone" counts only photos that can still go; stuck ones
  are named as "N couldn't upload — see the journal".
- **The toast changes** from "…was dropped" to "A photo couldn't be
  uploaded — it's still on this phone." (and the same for a memory).
- **The drawer's pending count includes stuck items**, and the sign-out
  warning names them, so signing out can't quietly delete them either.
- `409 That memory/photo id is already taken` is stuck like any other 4xx
  (a retry of the same upload already returns 200, so a 409 means
  something real is wrong).

### Phone: know when saving on the phone failed (Q-P3)

- `enqueue` reports failure instead of swallowing it. If a memory or photo
  couldn't be written to IndexedDB, the toast says so plainly ("Couldn't
  save on this phone — keep the app open until it uploads") instead of
  "Saved on this phone", and the row shows as unsaved.
- The first time something is queued, the app calls
  `navigator.storage.persist()` (best-effort; iOS may ignore it, an
  installed app is already favoured).

## Phases

Numbered 88–90; if Run 23 grows beyond Phase 87, its later phases take
the numbers after these (Q-P4).

- **Phase 88 — the server takes iPhone camera photos.**
  - **Scope:** `app/photos.py`: `"MPO": "jpeg"` in `FORMATS`; `draft` for
    `JPEG` and `MPO` in `_display`. A test fixture builds an MPO with
    Pillow (`save_all` + `append_images`). `docs/photos.md` notes the
    format.
  - **Tests:**
    - An MPO upload is accepted (201), stored as `original.jpeg`,
      byte-for-byte, served as `image/jpeg`; the display copy and thumb
      are made, upright, no EXIF.
    - A large MPO is decoded via `draft` (assert the decoded size is
      below full size, as the existing JPEG memory test does).
    - The existing JPEG / PNG / WebP / HEIC tests stay green; a GIF is
      still refused with the same message.
  - **Manual:** on an iPhone against a local or deployed build, Take
    photo → Save → Upload: it uploads and shows. Also a portrait-mode
    and a Live Photo capture.
- **Phase 89 — the outbox keeps what the server refused.**
  - **Scope:** `outbox.js` (a `stuck` field, `markStuck`, `retry`;
    `pending` returns stuck entries), `journalSlice.js` (`syncOutbox`
    classifies responses as above, holds a memory's later writes behind a
    stuck one, new toasts; `syncFailed` marks instead of removing;
    stuck photos counted apart in Upload), `applyPending` (draws stuck
    entries), the journal row's badge and its
    Save to phone / Try again / Remove sheet, the delete-memory and
    remove-photo confirmations, the drawer count and the
    sign-out warning. `docs/photos.md` updated.
  - **Tests:**
    - A 422 on a photo keeps it in the outbox as stuck, with the server's
      message; it's not sent again on the next pass; other memories still
      sync.
    - `403 PASSWORD_CHANGE_REQUIRED` keeps everything and stops the pass
      (nothing marked stuck); after the password change, it all sends.
    - A 422 on a memory's create holds its photos (not sent, not stuck
      themselves, not dropped).
    - Try again clears `stuck` and sends; Remove asks, then deletes.
    - Try all again and Upload send every stuck item once; one still
      refused stays stuck with the new message; one accepted is done.
    - After an app update (a new version id), stuck items are tried once,
      and not again on the next start.
    - Save to phone hands the stored bytes to `saveToPhone`.
    - A stuck item survives a reload and counts in the drawer; the
      sign-out warning mentions it.
    - **The photo stays on its memory:** after a 422, the memory in the
      store still lists the photo (marked stuck); after `fetchMemories`
      (cached copy, then the server's list without it), it's still there.
    - A 422 on a memory's create keeps the memory on screen, stuck.
    - Deleting a memory with a waiting or stuck photo shows the warning;
      confirming deletes it, cancelling keeps both.
    - Upload with one stuck and one waiting photo sends the waiting one,
      and the result names the stuck one separately.
    - 401 / 5xx / no response behave as before.
  - **Manual:** at 375 px, dark and light: the badge and sheet on a
    journal row with a stuck photo (force one with a GIF renamed `.jpg`).
- **Phase 90 — saving on the phone can't fail silently.**
  - **Scope:** `enqueue` returns success or failure; `createMemory` /
    `updateMemory` toast and mark the row accordingly;
    `navigator.storage.persist()` on first queue.
  - **Tests:**
    - With IndexedDB throwing on `set`, creating a memory shows the
      "couldn't save on this phone" toast, not "Saved on this phone".
    - `persist()` is asked once, and a missing `navigator.storage` is fine.

## Open questions

- **Q-P1. Accepting MPO.**
  - (a) *Recommended:* store it as uploaded, as a `jpeg` (keeps the full
    original, gain map and all).
  - (b) Re-save it as a plain JPEG on the server (drops the gain map; the
    original is no longer exactly what the phone took).
  - **Answer:** (a), 2026-10-08.
- **Q-P2. HDR in the display copy?** The display copy and thumb come from
  the main image only, so they show as standard (non-HDR) brightness; the
  stored original keeps its gain map, so downloads and the Pi backup are
  still HDR.
  - (a) *Recommended:* standard brightness for now; no cost (the gain map
    is never decoded). Revisit after the trip.
  - (b) HDR display copies: a gain-map JPEG writer (Pillow can't write
    one; a new library), more CPU and memory per photo on the 512 MB
    machine, larger display copies (data and offline storage), and patchy
    browser support for showing them.
  - **Answer:** (a), 2026-10-08: keep the original as uploaded; no HDR
    work, now or later.
- **Q-P3. Include Phase 90 in this run?** It's from the resilience review,
  not last night's bug, but it's the other way a memory can vanish from
  the phone before the trip.
  - (a) *Recommended:* yes.
  - (b) Leave it for later.
  - **Answer:** (a), 2026-10-08: all of this run's enhancements on one
    branch.
- **Q-P4. Order and branch.** Run 23 (large text) is planned and not
  started.
  - (a) *Recommended:* do Run 24 first, on its own branch off `main`, and
    deploy it before the trip; Run 23 follows.
  - (b) Finish Run 23 first.
  - **Answer:** (a), 2026-10-08: branch `photo-resilience`, off `main`
    at `7452475`.
- **Q-P5. Stuck items: kept until removed, or expire?**
  - (a) *Recommended:* kept until you tap Remove (they may be the only
    copy).
  - (b) Expire after N days.
  - **Answer:** (a), 2026-10-08, and they can be resynced (Try again, Try
    all again, Upload, and once after an app update; see Design).

## Built

- **Phase 88 (2026-10-08).** `FORMATS` maps `MPO` to `jpeg`; `_display`
  drafts for `JPEG_FORMATS` (`JPEG`, `MPO`). Pillow's own `thumbnail()` also
  calls `draft`, but for twice the display size, which leaves a 48 MP photo
  at full size; the test spies on `draft` and was checked to fail without
  the fix (decoded 8064 x 6048). The test MPO carries EXIF orientation 6 and
  GPS, so it also covers upright copies with no EXIF.
- **Phases 89–90 (2026-10-08), one commit** (both change the same
  thunks in `journalSlice.js`). Built as designed, with these differences:
  - **After an app update**, stuck memory writes are sent at once; stuck
    photos go back to *waiting for Upload* rather than uploading by
    themselves (Upload may be on cellular). The build id is
    `__BUILD_ID__` (`vite.config.js` `define`), compared with
    `localStorage["pripritrip-last-build"]`; the very first start never
    retries.
  - **Deleting a memory** with photos still on the phone warns in the
    delete dialog and says to open each and tap Save to phone; there's no
    Save button in the dialog itself.
  - **Removing a never-uploaded photo in the edit dialog** shows an inline
    warning with **Keep it** (undo) rather than a second dialog: the removal
    only happens on Save anyway.
  - **Removing a stuck memory that never reached the server** removes its
    waiting photos too (the dialog says so); alone they'd only be refused.
  - **`fetchMemories` refreshes the counts**, so the Upload and "couldn't
    upload" bars are right when the app starts offline (before, the counts
    only came from a sync). It runs after the "what's queued" snapshot, so
    the race guard from Run 4 keeps its order.
  - **Phase 90's fallback:** `enqueue` resolves true/false; on false,
    `keepOrSend` sends the write at once if it may, else marks the memory
    (or photo) `unsaved` and toasts that it isn't saved anywhere.
  - Tests: `Stuck.test.jsx` (11), `PhoneFull.test.jsx` (3), outbox unit
    tests (5), the sign-out warning; the old "dropped" test now asserts
    kept-and-marked. E2E `journal-stuck-photos.spec.js` with two fixtures:
    `camera-mpo.jpg` (a real MPO: 201, served as `image/jpeg`) and
    `not-a-photo.jpg` (a GIF named .jpg: 422, stuck, survives a reload).
