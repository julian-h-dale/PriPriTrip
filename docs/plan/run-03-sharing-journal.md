# Run stage 3 — sharing a trip, and the trip journal (memories)

Asked 2026-10-03 (Julian):
- **Sharing.** Two roles, **owner** (who created the trip) and **viewer**
  (the person the trip was planned for, "the pripri"). For now only the
  owner can edit, so there are no conflicts to handle. The owner can see the
  trip's id. The trips page gets a **Join** button: enter a trip id to join
  as a viewer.
- **Trip journal:** a shared account of the trip as it's experienced, made
  of **memories**.
  - A memory is a point-in-time note: a meal, a museum, a funny joke.
  - Memories are recorded per user. The journal only ever grows.
  - They're ordered by **creation time, set in UTC**.
  - Only a memory's author can edit or delete it.
  - Start simple: a "New memory" button on the Today tab, plain-text notes.
    Get the time and the ordering right first. Location, pictures and more
    come later.
- **Descoped for now:** pictures. Storing them is a bigger infrastructure
  decision, probably object storage beyond the Fly volume.

**Decisions** (answered 2026-10-03, and folded into the design below):
- **Join with the trip's id**, as Julian first asked. A separate join code
  was considered and skipped: with this few users, the extra table,
  endpoints and UI aren't worth it. The owner can still remove a viewer.
- A viewer editing gets **403**; a stranger gets 404. The owner sees and
  removes viewers, and a viewer can leave. Viewers see everything, with no
  edit controls. A seed viewer exists for trying it locally.
- A memory's time shows in **its author's zone at writing** (stored with
  it). Everyone on the trip sees everyone's memories. The journal is a
  **fourth tab**: Today | Timeline | Journal | Map. Julian is wary of a busy
  tab bar, but memories are spur-of-the-moment, so a tab for now.
- An author shows as their **email** for now.
- **Offline capture is deferred:** writing a memory needs a connection.
- Plain text up to 2,000 characters, and "edited" on a changed memory.

### Design

**Data: new tables only.** Nothing is added to the existing tables. The app
creates missing tables when it starts (`create_all`), so this lands
**without** a `make reset-db`, and the real Okinawa trip in the dev database
survives.
- **`trip_members`:**
  - `id` (UUID), `trip_id`, `user_id`, `role` (`"viewer"` for now) and
    `created_at` (`UtcDateTime`), plus soft delete;
  - unique on `(trip_id, user_id)` among live rows.
  - The owner stays `trips.user_id`, with no member row, so every existing
    query and ownership rule keeps working unchanged.
- **`memories`:**
  - `id` (UUID), `trip_id`, `user_id` (the author) and `text`
    (1–2,000 characters after trimming);
  - `created_at` (`UtcDateTime`): set by the server, never sent by the
    client, and the **only** ordering key, with `id` as the tiebreak;
  - `zone`: the author's IANA zone at that moment, which the browser
    reports, used only for display;
  - `updated_at` (`UtcDateTime`, nullable), plus soft delete.
  - An edit never changes `created_at`, so editing never reorders the
    journal.

**Access: one place, two levels.** This follows the template's
`get_owned_resource` pattern.
- `get_viewable_trip` lets in the owner **or** a live member, and gives 404
  to everyone else. Every read uses it: the trip, the trip list, memories,
  and the offline cache's fetches.
- `get_owned_trip` is unchanged and owner-only. Every trip edit keeps it,
  so viewers can't edit by construction. A viewer who tries to edit gets
  **403** (they know the trip exists); a stranger still gets 404.
- `get_own_memory` gets the memory through a viewable trip and checks
  `memory.user_id == user.id`, else 403. It's used for editing and
  deleting memories.
- A response that says who someone is gives their email (no names yet),
  and nothing else about them.

**API:**
- **Trips:**
  - `GET /trips` returns owned **and** joined trips, each with `role`
    (`"owner"` | `"viewer"`).
  - `GET /trips/{id}` (`TripRead`) gains `role`, so the UI knows whether it
    can edit.
- **Sharing:**
  - `POST /trips/join` with `{ tripId }` joins as a viewer and returns the
    trip summary. Joining twice does nothing new. An unknown or deleted trip
    gets 404. The owner joining their own trip gets 409.
  - `GET /trips/{id}/members` (owner) lists the viewers with their emails
    and join dates. `DELETE /trips/{id}/members/{user_id}` (owner) removes one.
  - `DELETE /trips/{id}/membership` lets a viewer leave.
- **Journal:**
  - `GET /trips/{id}/memories` returns every member's memories, oldest
    first (by `created_at`, then `id`), each with the author's email, `mine`,
    `createdAt`, `zone` and `updatedAt`.
  - `POST /trips/{id}/memories` takes `{ text, zone }`; the server stamps
    `created_at` in UTC.
  - `PUT` and `DELETE /trips/{id}/memories/{memory_id}` are author only.
    Deleting is soft.

**UI:**
- **Read-only for viewers.** `selectReadOnly` becomes "offline, or a saved
  copy, **or** `role === "viewer"`". Every edit control already uses it, so
  viewers see the trip with no edit controls (hidden, not just greyed).
- **Memories** have their own rule, `selectCanWriteMemory`: online and a
  member. A viewer can write memories but can't edit the trip.
- **Sharing:**
  - The trips page's Join button opens a dialog to paste the trip id.
    After joining it shows a toast and opens the trip.
  - The owner gets a **Share trip** button in the trip's top bar. It opens
    a dialog with the trip id (with copy) and the viewers (with Remove).
  - A viewer's ⋯ menu on the trips list says **Leave trip** instead of
    Delete.
  - Trip cards say "Shared with you" for viewers.
- **Journal:**
  - The Today tab gets a **New memory** button, which opens a textarea
    dialog. Saving shows a toast, and the memory appears at once.
  - A **Journal** tab groups memories by day. A
    memory's day is its local date in the zone it was written in. Inside a
    day they run oldest first.
  - Each memory shows its time (with "Tokyo time" when it differs from the
    trip's zone), its author, and "edited" if it was.
  - Your own memories have a ⋯ menu with Edit and Delete (Delete asks
    first).
  - Memories written before the trip starts or after it ends go in "Before
    the trip" and "After the trip" groups.
- **Offline:** memories are cached with the trip and readable offline.
  Writing one needs a connection for now (offline capture is deferred).

**Time and ordering, the part to get right:**
- `created_at` is an **instant** (`UtcDateTime`), stamped by the server.
  The ordering never depends on a phone's clock or zone.
- The display zone is stored, not inferred, so a memory written in Tokyo
  still reads "8:14 PM Tokyo time" when viewed later from Chicago.
- **Tests pin this down:**
  - two memories written a second apart in different zones order by
    instant, not by local wall clock;
  - an edit keeps a memory's place;
  - day grouping is right across midnight and the date line (a memory
    written at 00:30 Tokyo time is that Tokyo date);
  - a bad zone is rejected (checked with `zoneinfo`, like the trip's).

### Phase 25 — Run: sharing API

- `trip_members`, `get_viewable_trip`, the 403/404 split,
  and `role` on the trip list and `TripRead`.
- The join, members, remove and leave endpoints.
- `make seed` gains a second traveler (`SEED_VIEWER_EMAIL` and
  `SEED_VIEWER_PASSWORD`) who joins the sample trip, so both roles can be
  tried locally (Q-S5).
- **Tests:**
  - a viewer can read but every edit route gives 403, and a stranger gets
    404 everywhere;
  - joining (twice, an unknown trip, a deleted trip, the owner's own
    trip);
  - remove and leave;
  - the list shows joined trips with their role;
  - a soft-deleted trip disappears for viewers too.

### Phase 26 — Run: sharing UI ✅

- The Join dialog, the owner's Share dialog (the trip id with copy, and the
  members with Remove), and Leave trip.
- Read-only for viewers through `selectReadOnly`, and the "Shared with you"
  label.
- **Tests:**
  - the viewer UI has no edit controls;
  - joining opens the trip;
  - the share dialog's id and member removal;
  - leaving removes the trip from the list.
- **Live:** two browser contexts, owner and viewer, in Playwright.

### Phase 27 — Run: memories API ✅

- The `memories` table, the endpoints, `get_own_memory`, and the zone check.
- **Tests:**
  - only the author can edit or delete (403 for another member, 404 for a
    stranger);
  - the ordering is by server UTC instant, and an edit doesn't reorder;
  - the text limits;
  - a viewer can create;
  - deleted memories are hidden.

### Phase 28 — Run: memories UI ✅

- New memory on Today, the Journal view grouped by day, edit and delete
  your own, and caching the journal for offline reading.
- `journalDays(memories, trip)` is pure and groups by the local date in
  each memory's zone, with the before/after groups.
- **Tests:**
  - `journalDays` across midnight and the date line;
  - the before/after groups;
  - an edit keeps its place;
  - only your own memories show Edit and Delete;
  - New memory is disabled offline.

**Built (2026-10-03):** Phases 25–28, one commit each (plus a mypy fix
after 25).
- `make verify`: 133 API + 217 UI tests. `ui/e2e/trip.spec.js` (12 tests,
  owner and viewer in two browser contexts) passes live.
- The new tables are created at startup, so no `make reset-db` was needed;
  `make seed` adds the viewer.
- **Waiting on:** Julian's look at 375px, and a real two-phone test after
  the Fly deploy.

### Open questions (Run stage 3)

Sharing:

- **Q-S1. What does a viewer enter to join?**
  - (a) The trip's id, as asked. It works, but the id is in every trip URL
    (`/trips/<id>/…`), so anyone who sees a link or screenshot of a URL can
    join, and it can never be revoked.
  - (b) A separate **join code** the owner sees on a Share screen. It's
    random and unguessable, and "New code" revokes the old one.
  - Recommendation: **(b)**. It's the same flow (copy it, send it, paste it
    into Join) and costs one small table.
  - **Answer:** the trip id: a join code isn't worth the extra effort for this few users (2026-10-03).
- **Q-S2. What happens when a viewer tries to edit?**
  - Recommendation: **403** for a member and 404 for a stranger. In
    practice the UI never offers them an edit control anyway.
  - **Answer:** yes (2026-10-03).
- **Q-S3. Managing who's on the trip.**
  - Recommendation: the owner sees the viewers and can remove one, and a
    viewer can leave.
  - **Answer:** yes (2026-10-03).
- **Q-S4. What does a viewer see?**
  - Recommendation: **everything**, including confirmation numbers, since
    the viewer is a traveler. Edit controls are **hidden** for viewers, not
    greyed as they are offline, because a viewer can never edit.
  - **Answer:** yes (2026-10-03).
- **Q-S5. A second dev user to try sharing locally?**
  - Recommendation: **yes**, a seed "viewer" user who has already joined
    the sample trip.
  - **Answer:** yes (2026-10-03).

Journal:

- **Q-J1. Which clock does a memory's time show in?** The instant is UTC
  either way, which settles the ordering.
  - (a) The trip's zone.
  - (b) The viewing phone's current zone.
  - (c) **The zone the author's phone was in when they wrote it**, stored
    with the memory.
  - Recommendation: **(c)**. A dinner in Tokyo should read 8 PM even when
    you reread it in Chicago, and phones switch zone automatically while
    traveling.
  - **Answer:** yes, (c) (2026-10-03).
- **Q-J2. Who sees whose memories?**
  - Recommendation: **everyone on the trip sees everyone's**, labelled by
    author. That's what makes it a shared journal. Only the author can edit
    or delete.
  - **Answer:** yes (2026-10-03).
- **Q-J3. Where does the journal live?**
  - (a) A fourth tab: **Today | Timeline | Journal | Map**.
  - (b) A section on Today (today's memories) plus each day page.
  - (c) Both: a Journal tab for the whole story, and each day's memories
    on its day page.
  - Recommendation: **(a)** now, then (c) once memories carry a location or
    an event.
  - **Answer:** (a) a tab for now; Julian is wary of a busy tab bar (2026-10-03).
- **Q-J4. How is the author named?** Accounts have an empty `name` today.
  - Recommendation: show the name when it's set, else the part of the email
    before the @. Add a "Your name" field in the drawer.
  - **Answer:** just the email for now (2026-10-03).
- **Q-J5. Writing a memory offline?** It's the most likely moment to want
  one: no signal on a mountain.
  - Recommendation: **online-only for this stage**. Offline capture is the
    first thing after it: an outbox, with the UUID made on the phone so a
    retry can't create a duplicate.
  - The catch: offline capture needs the *phone's* time as the creation
    time (validated as not in the future), which bends "set in UTC by the
    server". Decide that when we get there.
  - **Answer:** deferred (2026-10-03).
- **Q-J6. Limits and wording.** Plain text up to 2,000 characters, and
  "edited" shown on a changed memory.
  - Recommendation: as stated.
  - **Answer:** yes (2026-10-03).
