# Run stage 7 — more than one person editing a trip

Asked 2026-10-04 (Julian): let several people edit a trip. Conflicts on the
same entry are rare, but the "one trip document" model looked like it would
make them worse.

### Where we are

- **Writes are already per entry:** `PUT/DELETE /trips/{id}/items/{itemId}`
  (and `/move`), and the same for days, stays and travels. Only the
  **responses** are the whole trip. That stays: it gives the editor
  everyone else's changes after every save. So **no API breakdown is
  needed**.
- **Shared members are view-only:** `get_owned_trip` lets only the owner
  write (a member gets 403), and `TripMember.role` is always `"viewer"`.
- **Two people editing the same entry today:** the later save silently
  overwrites the earlier one (last write wins), with no warning.
- **Trip edits are online-only** (only memories go through the outbox), so
  there are no offline trip edits to reconcile.
- **Memories are per author** and already safe to retry (phone-made ids).
  They aren't part of this stage.

### The common approaches (simplest first)

1. **Last write wins.** What we have. Fine when conflicts are rare and
   cheap.
2. **Optimistic concurrency.** The standard for REST APIs. Each row has a
   `version`; the client says which version it edited (`If-Match`); a stale
   write gets **409** and the user picks theirs or mine. Nothing is lost
   silently.
3. **Field-level PATCH and merge.** Send only the fields that changed, so
   two people editing different fields of one entry both win. Builds on 2.
4. **Live updates** (SSE or WebSocket) push changes to the other phones, so
   screens are seconds stale, not minutes. Often with "PriPri is editing".
5. **A sync engine or CRDTs** (Yjs, Automerge, Replicache/Zero, PowerSync,
   ElectricSQL): offline-first, merged automatically. A rewrite of the data
   layer; overkill for two or three people planning a trip.

(Pessimistic locking, "PriPri has this checked out", is the other classic.
It's a poor fit for phones that drop offline: a lock can be stuck on a
phone in a tunnel.)

**Chosen:** 2, plus a cheap part of 4 (refetch when the app comes back to
the foreground). 3 and full live updates only if 409s turn out to be
annoying in practice.

**Decisions** (answered 2026-10-04):
- **A separate editor join code.** Joining with the viewer code makes you a
  viewer; joining with the editor code makes you an editor.
- **Editors can delete** stays, travels, days and activities. Only the
  trip itself stays owner-only.
- **A conflict is an error and a reload,** not a merge. No "theirs vs mine"
  dialog and no "Use mine". Your unsaved edit is dropped, and you redo it on
  the fresh copy if you still want it.
- **Trip editing stays online-only.** Nothing about trip edits is queued
  offline (only memories are), so there's nothing to reconcile later.
- **Show who last changed an entry** in its details ("Edited by PriPri, 2
  minutes ago"). Possibly hidden before the trip.

### Design

**1. An editor role.**
- `TripMember.role`: `"viewer"` or `"editor"`.
- **Two join codes per trip:** the existing one (viewer) and a new editor
  code (a new column on `trips`, generated the same way). `POST
  /trips/join` looks the code up in both and gives the matching role.
  Joining again with the other code changes your role to that code's.
- The share dialog shows both codes, labelled "Can view" and "Can edit".
  The owner can make a new editor code (the old one stops working; people
  who already joined keep their role) and remove members, as now.
- `get_owned_trip` becomes **`get_editable_trip`**: owner or editor, else
  403 for a viewer and 404 for anyone else. Every trip-child write already
  goes through it, so this is the one place. `ViewableTrip.role` gains
  `"editor"`, and the UI already shows edit controls by role.
- **Owner only, still:** deleting the trip, managing members and the join
  codes.
- Editors can add, change, move and delete days, activities, stays and
  travels (soft delete, as now).

**2. Versions (optimistic concurrency).**
- Stays, travels, days and items get `version` (int, starts at 1),
  `updated_at` (`UtcDateTime`) and `updated_by` (user id). One migration;
  existing rows get version 1 and `updated_at` = now.
- Every entry in `TripRead` carries its `version`, plus `updatedAt` and
  `updatedByName` for the conflict message.
- **`PUT` and `DELETE` on an entry need `If-Match: <version>`.** One helper
  in `services/` checks it and bumps the version, so each write calls it
  instead of checking by hand:
  - a match: the write goes ahead, and `version + 1`;
  - a mismatch: **409** with the entry's current state, its version, and
    who changed it and when;
  - no header: **428 Precondition Required**, so an old cached app can't
    silently overwrite. Its toast says to reload the app.
  - an entry deleted meanwhile: **404**, as now.
  - **Why a missing header is refused:** after a deploy, an installed app
    can run its old cached code until it's reopened. That code sends no
    version, so the server can't tell whether its save would overwrite
    someone. Refusing it means the old app shows its usual "couldn't save"
    error, and reopening the app fixes it. Nothing is overwritten.
- **Not versioned:** adding (nothing to conflict with; the server picks the
  position) and **moving up/down** (`/move` only swaps positions; it
  doesn't bump the content version, so reordering never blocks an edit).
  Moving an activity to another day is a content change (its `date`), so
  it is versioned.

**3. Conflicts in the UI.**
- The forms send the `version` they were opened with.
- **On 409:** the form closes, a warning says "PriPri changed this 4 minutes
  ago. Showing the latest.", and the trip reloads. Your edit is dropped.
- **On 404 while saving or deleting:** "This was removed by someone else",
  and the trip reloads.
- **On 428** (only an out-of-date app could get it, and the new app always
  sends a version): "The app has been updated. Close and reopen it."
- **Who changed it:** an entry's details show "Edited by PriPri, 2 minutes
  ago" (`updatedByName`, `updatedAt`). One component, so it's easy to hide
  later.
- **Fewer stale screens:** the trip is refetched when the app returns to the
  foreground (online). The same trigger already syncs the outbox.

### Phases

- **Phase 40 — editors (API + UI).** ✅ (2026-10-04)
  - **Built as planned. Details:**
    - **The view code is the trip's id** (as before), so viewers already
      know it. The edit code is a separate random secret
      (`trips.edit_code`, 20 URL-safe characters, migration 0005), made the
      first time the owner opens Share. `GET /trips/{id}/edit-code` reads
      it and `POST` renews it, both owner only.
    - **`POST /trips/join` takes `{code}`:** a trip id makes a viewer, an
      edit code an editor. `{tripId}` still works for older apps.
    - **`get_editable_trip`** (owner or editor) guards every trip-child
      write, through `get_editable_item/stay/travel`. **`get_owned_trip`**
      is now only for deleting the trip, the members list, removing members
      and the edit code.
    - **The Join dialog** takes either code ("Trip code"); the server tells
      them apart.
    - **The Share dialog** has two sections: "Can view" and "Can edit"
      (with a two-tap "New edit code"). Each member shows "Can edit" or
      "Can view". The trips list says "Shared with you · you can edit".
    - **E2E:** the seed admin joins with the edit code, gets edit controls,
      then leaves again (screenshot `21a`).
  - **Tests:** the editor code makes an editor and the viewer code a
    viewer; rejoining with the other code changes the role; a new editor
    code stops the old one working. An editor can add, change, move and
    delete each kind of entry, and can't delete the trip, see or renew the
    codes, or remove members (403). A viewer still gets 403 on writes; a
    stranger gets 404.
  - **Julian:** with two accounts, join with the editor code; the second
    phone shows edit controls.
- **Phase 41 — versions and 409 (API).** ✅ (2026-10-04)
  - **Built as planned, with these details and deviations:**
    - **`VersionedMixin`** (`version`, `updated_at`, `updated_by`) on
      stays, travels, days and items; the check and the stamp live in
      `services/versions.py`. The `if_match_version` dependency (in
      `dependencies.py`) reads the header before the body is validated.
    - **Deviation: `updated_by` has no foreign key.** On SQLite, adding a
      foreign key rebuilds the table, and rebuilding `days` or `stays`
      fails once activities point at them. The migration test only passed
      because its database was empty; a copy of the dev database failed.
      So 0006 is plain `ADD COLUMN`s, and the migration test now plants a
      day and an activity, so it would catch a rebuild.
    - **Existing rows keep `updated_at` null** (the plan said "now"): they
      were imported, never edited, so there's no one to name.
    - **A date with no day row is version 0**, so creating a day is
      versioned too. Making an activity on an untitled date creates the
      day at version 1.
    - **If-Match** takes `"3"`, `W/"3"` or `3`. A missing one is 428 (its
      message says to reopen the app); a malformed one is 400.
    - **The 409 body** is `{detail: {message, version, updatedAt,
      updatedByName, current}}`. `current` is the entry as the trip reads
      it now.
    - Every entry reads back with `version`, plus `updatedAt` and
      `updatedByName` once edited through the API (the user's name, else
      the first part of their email). Adding an entry stamps it too.
  - **Don't deploy Phase 41 without Phase 42:** the deployed app sends no
    version, so its edits would all get 428.
  - **Tests:** a matching `If-Match` saves and bumps the version; a stale
    one gives 409 with the current entry and who changed it; no header
    gives 428; an entry deleted meanwhile gives 404. `/move` doesn't change
    versions. The migration upgrades an existing database (versions 1).
- **Phase 42 — conflicts in the UI.** ✅ (2026-10-04)
  - **Built as planned. Details:**
    - Every change and delete thunk takes the entry's `version` and sends
      `If-Match`. Updating a day sends its row's version, or 0.
    - **`tripEdit` handles 409, 404 and 428 in one place.** 409/404: a
      warning toast ("PriPri changed this 2 minutes ago. Showing the
      latest." / "That was removed by someone else."), then `fetchTrip`, and
      the edit resolves to `{ reloaded: true }`, which closes the forms.
      428: an error toast, and the form stays open, saying to reopen the
      app.
    - **The API client's generic error toast skips statuses a request
      `handles`** (trip edits: 404, 409, 428). Without that, a 409 also
      showed "Request failed".
    - **"Edited by PriPri, 2 minutes ago"** is one small `EditedBy`
      component at the end of `EntryDetails` (`formatAgo` in `time.js`),
      easy to hide before the trip.
    - **`useTripRefresh`** (in App) reloads the open trip when the app
      returns to the foreground, online.
    - **E2E:** the owner and the seed admin (an editor) open the same
      dinner; the admin saves first, and the owner gets the warning and the
      admin's version (screenshot `24`). The test restores the dinner and
      leaves afterwards.
    - Fixed a Phase 38 miss: the `journal-location` e2e assumed memory pins
      show by default; it now turns on Journal (and matches only its own
      memory, so a failed run's leftovers can't break the next one).
  - **Tests:** a 409 closes the form, warns with the other person's name,
    and reloads the trip; a 404 warns and reloads; a 428 says to reopen the
    app; the details show who edited an entry and when; returning to the
    foreground refetches.
  - **Julian, on two phones:** both open the same activity, both save, and
    the second phone gets the warning and the first phone's change.

### Deferred: "theirs or mine" on a conflict

Not built now (Julian, 2026-10-04: a conflict is just an error and a
reload). If losing an edit on a conflict turns out to annoy, this is the
next step up, and the 409 already carries what it needs:
- **On 409, a dialog instead of a reload:** "PriPri changed this 4 minutes
  ago", with their version and yours side by side, field by field, and the
  differences marked.
- **Keep theirs:** drops your edit and reloads (what Phase 42 does anyway).
- **Use mine:** re-sends your edit with their version number in
  `If-Match`, so it deliberately overwrites theirs.
- A cheaper middle step: on a conflict, keep your typed text and reopen the
  form on the fresh copy, so you can re-apply it by hand.
- Further up: field-level merge (approach 3), so edits to different fields
  of one entry both win without asking.

### Open questions (Run stage 7)

All answered 2026-10-04 (see Decisions above):
1. How does someone become an editor? **A separate editor join code.**
2. Can editors delete stays and travels? **Yes.**
3. A save with no version? **Refused (428).** It only happens to an
   out-of-date installed app, for the minutes before it's reopened.
4. Show who last changed an entry? **Yes, in its details** (maybe hidden
   before the trip).
