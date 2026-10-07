# Run stage 5 — Take photo, staying signed in, photos wait for Wi-Fi

Asked 2026-10-03 (Julian, after trying the deployed app on his phone):
- **"Add photos" opened the gallery, with no camera.** Recent Android goes
  straight to the gallery for `accept="image/*"`; only iOS offers "Take
  Photo" in that menu. Add a button that opens the camera.
- **Stay signed in** as long as the app is used within the 60-day window.
- **Photos wait on the phone until the user uploads them.** A web app can't
  tell Wi-Fi from cellular on iOS (only Chrome on Android can), and it
  can't run on a schedule in the background (no iOS background sync;
  Android's periodic sync can't be timed or relied on). So the user chooses
  when, by hand.

**Decisions** (answered 2026-10-03):
- **Manual upload only.** No "upload automatically" switch.
- **Photos taken in the app usually aren't in the camera roll** (iOS, and
  most Android, with `capture`). A photo waiting to upload gets a warning
  *and* a "Save to phone" button.
- **A simple sliding window for sign-in.** No server-side token list and
  no remote sign-out; changing `JWT_SECRET` still signs everyone out.

### Design

**1. Take photo.** A second button beside "Add photos": the same hidden
input pattern with `accept="image/*" capture="environment"` (one photo, no
`multiple`), feeding the same `photos.add`. The phone's camera app takes
the picture, so there's still no permission prompt and no viewfinder of
ours. "Add photos" stays for the gallery.

**2. Staying signed in.**
- **Today:** one 60-day JWT at login, never refreshed. Day 61 signs you out
  however often you used the app. (Unsynced writes survive: the outbox is
  keyed by user and sends after the next sign-in.)
- **`POST /auth/refresh`** (bearer token required, through
  `current_active_user`): returns a fresh 60-day token. It lives in
  `routers/auth_refresh.py`, beside fastapi-users' own `/auth/login`, and
  keeps its `{access_token, token_type}` shape.
- **The app refreshes quietly** when it starts or returns to the foreground,
  online only, and only if the token is more than a day old (`exp − 60
  days`, read from the token itself; no extra storage). A failed refresh is
  ignored: the token in hand still works until it expires.
- So any use within 60 days keeps you signed in indefinitely, and 60 days
  away means signing in again.

**3. Photos wait for an upload.**
- **Memory text still syncs straight away** (it's tiny). Only `addPhoto`
  outbox entries are held. `removePhoto` and deletes still sync, so
  removing a waiting photo still sends nothing.
- **`syncOutbox` skips `addPhoto`** unless asked: `uploadPhotos()` runs the
  same loop with photos included. The automatic triggers (start, reconnect,
  foreground, every 30 s) never send photos.
- **Waiting photos show on their memory** from their local bytes (the
  outbox already keeps them), marked "Waiting to upload".
- **The Journal shows one bar while anything waits:** "12 photos waiting
  (85 MB) · Upload", with progress ("Uploading 3 of 12"). An interrupted
  upload resumes on the next tap, and a photo already sent isn't sent again
  (photo ids make retries safe, Phase 32).
- **Save to phone**, on a waiting photo (and in the viewer): the share sheet
  with the file (`navigator.share({files})`, which offers "Save Image" on
  iOS), falling back to a download where file sharing isn't supported.
- **The warning** on the bar and in the memory dialog: "Photos taken here
  aren't in your camera roll until you save them. Not uploaded yet."
- **Keep the stash:** `navigator.storage.persist()` at startup (granted
  automatically for an installed app on most browsers; best effort).
- **Signing out** with photos waiting gets its own, stronger warning, on top
  of the existing unsynced-memories one.
- **Other people on the trip see a memory's photos only after the upload.**
  The memory itself appears straight away.

### Phases

- **Phase 34 — Take photo (UI).** ✅
  - **Built as planned.** Disabled at 10 photos, like "Add photos".
    Checked at 375px in a Playwright screenshot (both buttons fit on one
    line).
  - The "Take photo" button and its `capture="environment"` input.
  - **Tests:** the button's input has `capture="environment"` and no
    `multiple`; a picked file joins the previews like "Add photos".
  - **Julian, on a real phone over HTTPS:** Take photo opens the camera,
    and Add photos still opens the gallery.
- **Phase 35 — staying signed in.** ✅
  - **Built as planned, plus:**
    - **"Over a day old" is read from `exp`:** a token with less than 59
      days left. The app assumes the server's 60 days; if that's ever
      shorter, it just refreshes on each open, which is harmless.
    - **A `background` request option:** a failed refresh shows no toast
      (a 401 still signs out, as it should for an expired token).
    - **A refresh landing after a sign-out is ignored,** so it can't sign
      anyone back in.
    - **Live:** a real login against the dev API refreshes with 200; no
      token gets 401.
  - `POST /auth/refresh` and the quiet refresh in the app.
  - **Tests:**
    - API: a valid token gets a new one with a later `exp`; no token, an
      expired token or an inactive user gets 401.
    - UI: a token over a day old is refreshed on start and stored; a fresh
      one isn't; offline or a failed refresh leaves the old token in place.
- **Phase 36 — photos wait for an upload (UI).** ✅
  - **Built as planned, plus:**
    - **Two counts instead of one:** memory writes (they drive the 30 s
      retry and the sign-out warning) and waiting photos with their size.
      Counting held photos as "pending" would have retried every 30 s
      forever.
    - **Save to phone lives in the viewer** (tap a waiting thumbnail). The
      file is read ahead when the photo is shown, because iOS only opens
      the share sheet straight after a tap.
    - **The bar counts photos across all trips,** because Upload sends
      them all. It's disabled offline.
    - **Fixed, found by the parallel e2e run:** a memory whose photos were
      waiting could vanish from the journal on reconnect (the
      refresh/sync race from Phase 33: held photos made the memory look
      unsent). A regression test fails without the fix.
    - **Also fixed:** the sharing e2e test now looks for "Shared with you"
      on the sample trip only (the Athens demo trip is shared too).
    - **Live:** the updated `journal-photos.spec.js` passes; the full live
      suite passed 5 runs in a row.
  - Held `addPhoto` entries, the upload bar with progress, waiting
    thumbnails from local bytes, Save to phone, the warnings,
    `storage.persist()`.
  - **Tests:**
    - automatic sync sends memories but not photos; Upload sends the
      photos, oldest first, after their memory;
    - an interrupted upload resumes without duplicates;
    - the bar's count and size; a removed waiting photo sends nothing;
    - Save to phone shares the file, or downloads it without file sharing;
    - signing out with photos waiting warns.
  - **Live:** update `e2e/journal-photos.spec.js`: photos picked offline
    don't upload on reconnect; Upload sends them.
  - **Julian, on a real phone:** take a photo, check the warning, Save to
    phone, then upload on Wi-Fi.

### Fix (2026-10-04): photo uploads killed for running out of memory on Fly

**Seen:** uploads failed intermittently. `fly logs` showed `Out of memory:
Killed process (gunicorn)` with the worker at about 290 MB, on a 512 MB
machine running nginx and **two** workers.

**Cause:** `photos.process` held several full-size decoded copies at once:
the decode, the rotate, the RGB convert, and a full copy before each
resize. A decoded photo is width x height x 3 bytes (72 MB at 24 MP, the
iPhone 15/16 default), so each upload's extra peak was about 191 MB at
12 MP, 344 MB at 24 MP and 639 MB at 48 MP. Two workers could also
process two photos at once, because the one-at-a-time lock is per process.

**Fix (Julian chose 1 and 2; 3 is held in reserve before the trip):**
1. **A leaner pipeline** (`photos._display`), with the same output:
   - JPEGs are decoded at 1/2, 1/4 or 1/8 scale where that still gives at
     least the display size (`draft`, asked for the fitted size such as
     2560 x 1920, not a 2560 box, which blocks non-square photos);
   - the image is shrunk in place, then turned upright, so the rotation
     copies a display-size image;
   - the thumbnail is made from the display copy;
   - no RGB convert when the photo is already RGB;
   - the reported width and height still come from the original (the
     file header, swapped for sideways orientations).
   - **Measured on the Pi** (fresh process each, sideways synthetic JPEGs):
     12 MP 191 → 98 MB, 24 MP 344 → 66 MB, 48 MP 639 → 97 MB.
2. **One gunicorn worker** (`deploy/start.sh`): one less baseline, and the
   photo lock now covers the whole server.
3. **Held in reserve:** 1 GB (`memory = "1gb"` under `[[vm]]` in
   `fly.toml`). Do it before the trip if any kill shows in `fly logs`. HEIC
   can't be decoded smaller, so it still decodes at full size.

**Tests:** a 24 MP sideways JPEG with a colour profile keeps its full upright
size, and its display copy and thumbnail are upright and keep the profile.
This guards the output; peak memory isn't unit-testable (Pillow allocates
outside Python), so the numbers above are the record.
