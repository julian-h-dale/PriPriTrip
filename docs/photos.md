# How journal photos work

A high-level tour of a photo's life: picked on the phone, waiting on the
phone, uploaded, resized on the server, stored on the Fly volume, shown in
the app, and copied to the Raspberry Pi. For the details, follow the file
names.

```
 Phone (the app)                       Fly machine                         Raspberry Pi
 ───────────────                       ───────────                         ────────────
 Take photo / Add photos
        │
        ▼
 IndexedDB outbox  ── tap Upload ──▶  POST …/memories/<id>/photos
 (the photo's bytes,                   │  resize (Pillow, one at a time)
  shown from there)                    ▼
                                      /data/photos/<trip>/<photo>/
                                        original.<ext>  display.jpg  thumb.jpg
                                      /data/app.db  (the Photo row)
        ◀── GET /photos/<id>/thumb|display ──┘
 service worker caches                         ▲
 thumbs and display copies                     │ every 30 min:
                                               │ GET /admin/backup/photos,
                                               └─ then each original ── USB drive
```

## 1. On the phone: picking and waiting

- **Picking** (`ui/src/features/journal/MemoryDialog.jsx`): a memory can have
  up to 10 photos, each up to 25 MB.
  - **Take photo** opens the camera (`capture`).
  - **Add photos** opens the phone's own picker.
  - Nothing is resized on the phone: the original file is what gets stored
    and later uploaded.
- **The outbox** (`ui/src/shared/services/outbox.js`): every write goes
  into an IndexedDB store on the phone (`pripritrip-outbox`) before it goes
  anywhere else.
  - A photo is an `addPhoto` entry holding the file's bytes (as an
    ArrayBuffer, because older iOS was unreliable with Blobs in IndexedDB),
    its type and name, and an id the phone makes up.
  - The id stays with the photo, so a retried upload can't create a
    duplicate.
- **Shown from the phone's copy:** until a photo is uploaded, the journal
  shows it from those bytes (a `blob:` URL) and marks it "waiting".
- **Photos wait for you; text doesn't** (`journalSlice.js`, `syncOutbox`):
  - Memory text, edits and deletes sync automatically whenever the app is
    online.
  - Photos stay on the phone until you tap **Upload** on the Journal page.
    A web app can't tell Wi-Fi from cellular, so you choose when.
  - The upload bar shows how many photos are waiting and their total size.
- **After upload** the outbox entry is deleted, so the phone no longer keeps
  its own copy.
  - A photo taken in the app was never in the camera roll. To keep a copy on
    the phone, use the photo viewer: **Save to phone** while the photo is
    still waiting (the share sheet, `saveToPhone.js`), or **Download
    original** once it's uploaded.
  - Signing out with photos still waiting warns first, because it would
    delete them.

## 2. Upload and resizing (the server)

- **Upload:** a multipart `POST /trips/<trip>/memories/<memory>/photos`
  (`api/app/routers/photos.py`) carrying the photo's id and file.
- **Resizing** (`api/app/photos.py`, run by `services/photos.py`) uses Pillow
  (with `pillow-heif` for iPhone HEIC). A photo taken with the in-app camera
  on an iPhone is a JPEG with its HDR gain map inside (Pillow calls it MPO):
  it's kept as a JPEG, gain map and all, and the copies are made from its
  main image at standard brightness. From the original it makes:
  - **display.jpg:** at most 2560 px on the long edge, JPEG quality 85.
  - **thumb.jpg:** at most 480 px, JPEG quality 80.
  - Both are turned upright and have **no EXIF**, so no GPS location. They
    keep the colour profile (iPhones shoot in Display P3). Photos are never
    enlarged.
  - The **original** is kept exactly as uploaded: full quality, with its
    EXIF.
- **Memory-careful:** the machine has 512 MB.
  - Only one photo is processed at a time (a lock, plus one gunicorn
    worker).
  - JPEGs (camera MPOs too) are decoded at reduced size where possible.
  - Images whose pixel count would be absurd are refused.
  - A 24 MP photo peaks at about 70–100 MB.
- **Then** the three files are written and a `Photo` row is added to the
  database. If the row fails to save, the files are removed, so there are
  never orphaned files.

## 3. Storage on the Fly volume

- One Fly volume, mounted at **`/data`** (`fly.toml`), holds everything that
  must survive a redeploy. The machine itself is disposable.
  - `/data/app.db`: the SQLite database, including the `Photo` rows: who,
    which memory and trip, size, format, width and height.
  - `/data/photos/<trip id>/<photo id>/`: `original.<jpeg|png|webp|heic>`,
    `display.jpg` and `thumb.jpg` (`PHOTO_DIR`, `api/app/photo_store.py`).
  - `/data/documents/`: trip documents, which aren't photos.
- **Writes are crash-safe:** each file is written to a temporary name, then
  renamed.
- **Deleting a photo** soft-deletes its row and removes its folder at once,
  freeing the space. Deleting its memory or trip makes its URLs stop
  working.
- **Size:** the volume needs room for the originals. Grow it with
  `fly volumes extend <id> --size 10` (about 10 GB) before a photo-heavy
  trip.

## 4. Showing photos

- **URLs:** `GET /photos/<photo id>/thumb|display|original`.
  - There's no login on these; the photo's random id is the secret. That
    lets an `<img>` load them and the service worker cache them.
  - They return 404 once the photo, its memory or its trip is deleted.
  - Responses are cached for a year (`immutable`), because a photo's files
    never change under its id.
- **Offline** (the service worker, `ui/vite.config.js`):
  - Thumbnails are cached as they're seen (up to 3000), so a journal opened
    once shows its photos offline.
  - Display copies are cached as you open them (up to 200).
  - Originals are never cached; they load online only (the viewer's
    full-size view and **Download original**).

## 5. The backup to the Raspberry Pi

`scripts/pi-backup/` holds a Python script (standard library only), a
systemd service and timer, an env file and `install.sh`.

- **When:** every 30 minutes (`pripri-backup.timer`). If the Pi was off, the
  missed run happens at boot.
- **Each run** (`pripri_backup.py`):
  1. Refuses to start unless the backup USB drive is mounted, so it can never
     quietly fill the SD card.
  2. Signs in as the **backup account**, a superuser (credentials in
     `/etc/pripri-backup.env`).
  3. Pages through **`GET /admin/backup/photos`**, which lists live photos in
     upload order after a cursor. Each run starts from a little before where
     the last one stopped (`state.json`, with an hour of overlap).
  4. Downloads each **original** it doesn't already have.
     - It downloads to a `.part` file, checks the size, then renames it.
     - Files go to `<drive>/PriPriTrip/<trip>/<YYYY-MM-DD>/<HHMM>_<author>_<id>.<ext>`.
  5. Fetches **`GET /admin/backup/journals`** and rewrites each trip's
     `journal.json` (the memories' text) when it has changed.
  6. Logs a one-line summary (`journalctl -u pripri-backup`).
- **Nothing is ever deleted on the drive:** a photo deleted in the app stays
  in the backup. Only originals are backed up; the server can always remake
  the display copies and thumbnails.
- The admin endpoints live under `/admin` (superuser only), in
  `api/app/routers/admin.py` and `services/backup.py`.
