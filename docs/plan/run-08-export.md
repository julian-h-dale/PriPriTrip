# Run stage 8 — export a trip

Asked 2026-10-05 (Julian): move trips between environments and keep JSON
backups. Not complicated: a `make` task that calls an endpoint with a trip id.
(This is the "Export a trip as a document" backlog item.)

### Where we are

- **The format already exists.** The trip document (`schema/trip.schema.json`)
  is what import takes, and `GET /trips/{id}` already returns that shape
  "plus ids and audit fields" (Architecture Decisions: *Read shape =
  document shape*). Export is that read with the extras taken off.
- **Why not just save `GET /trips/{id}`:** it adds `id`, `createdAt`, `role`,
  per-entry `version`/`updatedAt`/`updatedByName`, and the read-only `zone`
  fields. Import is `extra="forbid"`, so that payload would be refused. The
  export has to be a **clean document that imports as it is**.
- **Import always creates a brand-new trip** (lessons, rule 6), so a moved or
  restored trip gets a new id, and importing twice makes two trips. That's
  the intended behaviour for "move between environments".
- **Auth is a bearer token** from `POST /auth/login` (form fields
  `username` and `password`). Locally the API is at `http://localhost:<API_PORT>`;
  on Fly it's behind nginx at `https://<app>.fly.dev/api` (rewrite-and-strip).

### Architecture decisions (this stage)

- **`GET /trips/{id}/export`** returns the trip document, camelCase, absent
  fields omitted, with `Content-Disposition: attachment` and a filename like
  `okinawa-taipei-trip-fall-2026.json`. Same visibility as `GET /trips/{id}`
  (`get_viewable_trip`), and 404 for a missing or foreign trip.
- **Thin router, logic in `services/trips.py`.** `export_trip(db, trip_id)`
  reads through the same query as `get_trip`, then builds a `TripDocument`
  from it. **No second hand-written field list:** it is derived from the
  document models, so a field added to the format is exported automatically.
- **Order is kept.** Days by date, items/stays/travels by position (as the
  read already does).
- **Round trip is a test, not a hope:** import a document, export it, and the
  result equals the original (after validation); and the export is accepted by
  `validate_trip_document`.
- **The make task is a script, not improvised work** (AGENTS hard rule):
  `scripts/trip-client.sh`, called by `make export-trip`. It logs in, calls the
  endpoint and writes the file. Nothing is saved but the JSON.
- **Backups hold personal data** (confirmation numbers, ticket numbers), so
  the default output folder `exports/` is git-ignored.

### Phases

- **Phase 43 — the export endpoint (API).** ✅ (2026-10-05)
  - **Scope:** `GET /trips/{trip_id}/export`; `services/trips.export_trip`;
    filename slug; document the endpoint in OpenAPI (response is the
    `/schema/trip` document).
  - **Out of scope:** memories, photos, members and share codes; any UI;
    an import task.
  - **Tests:** the export imports cleanly (and passes the JSON Schema); an
    import → export round trip equals the original, including the sample trip
    and `example-trip.json`; no ids, versions, `role` or `zone` leak; soft-deleted
    stays/travels/days/items are not exported; a stranger gets 404 and a
    signed-out call 401; a joined viewer/editor can export (per question 2);
    the download headers are right.
- **Phase 44 — `make export-trip` (and docs).** ✅ (2026-10-05)
  - **Scope:** `scripts/trip-client.sh`; `make export-trip TRIP=<id>`
    with `API_URL`, `OUT`, and `TRIP_EMAIL`/`TRIP_PASSWORD`; `make list-trips`
    (id, name and dates, from `GET /trips`) using the same login code; a line
    each in `make help`; a short "Moving a trip between environments" section in
    `README.md`; `exports/` in `.gitignore`.
  - **Tests / verification:** the script fails with a clear message when
    `TRIP`, the credentials or the server are missing, or the login or the
    export is refused (and leaves no empty file behind); manual: export a
    trip locally, then import the file into the Fly app and compare.

### Open questions (Run stage 8)

1. **What does "the trip" include?**
   - The document format has **no memories, photos, members or share codes**.
     So an export is a backup of the *plan* (trip, stays, travels, days,
     activities), not the journal. Recommended: plan only, and say so in the
     README. Backing up journal entries and photos is a much bigger feature
     (a zip, new import).
   - **Answer:** Yes, plan only: a JSON dump of the plan.
   - **Resolved:** the export is the trip document and nothing else.
2. **Who may export?**
   - Options: the owner only, or anyone who can see the trip (owner, editor,
     viewer). Recommended: anyone who can see it, since they can already read
     every field; the edit code is not part of the export.
   - **Answer:** Anyone with view access or above. No front end at all:
     just the backend, called from a make task.
   - **Resolved:** `get_viewable_trip` guards the endpoint; there is no UI.
3. **How should the task sign in?**
   - Options: (a) `EMAIL=` and `PASSWORD=` on the command line or in the
     environment (simple; ends up in shell history); (b) the script prompts
     for the password (not scriptable); (c) `TOKEN=` a bearer token you got
     another way. Recommended: (a) with the environment variables
     `TRIP_EMAIL` / `TRIP_PASSWORD`, and a prompt only if the password is
     unset and a terminal is attached.
   - **Answer:** Yes: set the trip email and password in the environment.
   - **Resolved:** `TRIP_EMAIL` / `TRIP_PASSWORD`, prompting for the password
     only when it is unset and a terminal is attached.
4. **Which server by default, and where does the file go?**
   - Recommended: `API_URL` defaults to the local API
     (`http://localhost:<API_PORT>` from `api/.env`, like `make dev-api`);
     for Fly pass `API_URL=https://pripri-trip.fly.dev/api`. Output defaults to
     `exports/<trip-name-slug>.json` (git-ignored); `OUT=-` writes to stdout.
   - **Answer:** Yes.
   - **Resolved:** defaults as recommended.
5. **Do you also want `make import-trip` and a way to find trip ids?**
   - Import exists as an endpoint and in the UI, but moving a trip is easier
     with a matching `make import-trip FILE=… API_URL=…` (the same login
     handling, about 20 lines). A `make list-trips` that prints id and name
     saves digging the id out of the UI's address bar. Recommended: add both
     to Phase 44; they share the script's login code. Or keep it to export only.
   - **Answer:** `list-trips`, but not import.
   - **Resolved:** Phase 44 adds `make list-trips` beside `make export-trip`;
     `make import-trip` is not built (import stays the UI and endpoint).
6. **A button in the UI?**
   - Not asked for. Recommended: no, keep it a developer task for now; a
     "Download trip" item in the trip menu is a small follow-up if wanted.
   - **Answer:** Agreed.
   - **Resolved:** no UI in this stage.
