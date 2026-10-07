# Run stage 17 — quiet offline, making someone an admin, what viewers see

Asked 2026-10-07 (Julian), after trying Run stage 16 on the phone:
1. In airplane mode, a lot of "Network Error" toasts, even where the page
   is showing the phone's saved copy.
2. Make a user an admin of the app (from the Admin page's table).
3. Viewers see only the Timeline, Journal and Map: no Today tab, no Stays
   or Travel views on the timeline, no Trip tools in the drawer.
4. Limit what viewers see on the map: activities and public memories only.

## Where we are

**Toasts.** `apiClient` shows an error toast for any failed request,
except:
- requests marked `offlineOk` (the ones the offline cache backs);
- requests marked `background`;
- statuses the caller handles itself.

Offline in the browser, moving around the app as the installed app does
(no reloads), these still toast "Network Error":
- **Packing** and **Documents**: their lists aren't cached, and the GETs
  aren't `offlineOk`.
- **An entry's page:** each mini map asks `/config` for the Maps key (not
  `offlineOk`). Place pickers do the same, and ask `/timezone` too.
- **Coming back to the app** while offline: the trip reload re-runs these.

**Roles.** Two kinds:
- **On a trip:** owner, editor, viewer (`trip_members.role`). Today the
  only way to change someone's role is for them to join again with the
  other code. The owner's Share dialog lists members and can only remove
  them.
- **In the app:** admin or not (`users.is_superuser`). The Admin page
  lists users (an "Admin" or "User" badge), invites people and resets
  passwords. There's no way to make someone an admin except the database
  or the seed.

**Viewers today:**
- They get every tab, Today included. Signing in lands on Today.
- On the timeline they get the Plan / Stays / Travel switch.
- The drawer has all the Trip tools, except Documents and Share trip.
- On the server, viewers already can't edit anything, can't see
  documents, see only public memories, and their trip read has no
  confirmation numbers. They can read weather and keep their own packing
  list.

## Design (assuming the recommended answers)

### 1. No network-error toasts for reads while offline (Q-T1)

- **One rule in `apiClient`:** a **read** (GET) that fails for want of a
  network never toasts. The offline bar already says the app is offline,
  and each page shows its saved copy, or its own "needs a connection" note
  where there's no saved copy.
- **Writes are different:** they still say they didn't go through, once,
  as "You're offline, so that wasn't saved" instead of "Network Error".
  The exception is journal memories and photos, which wait in the outbox
  as they do now.
- **Repeats:** the same toast twice within a few seconds shows once.
- **Packing and Documents:** their pages say "Needs a connection" when
  they can't load.
- **Map key and time zone lookups** (`/config`, `/timezone`) fail quietly;
  the mini map and the clock line just don't show.

### 2. Making someone an admin (Q-R1, Q-R2)

The app's own admin (`users.is_superuser`), not a role on a trip: e.g.
invite yourself under your own email, then make that user an admin, so
the seed's `admin@example.com` isn't the only one. Editor and viewer on a
trip stay as they are (joined with a code).

- **The Admin page's table of users:** the Role column becomes a choice,
  Admin or User, on each row. Changing it asks first ("Make
  julian@… an admin?").
- **Endpoint:** `PATCH /admin/users/:id` with `{ isSuperuser }`, behind
  `current_superuser` like the rest of `/admin`.
- **Safeguards** (Q-R2): your own row can't be changed (another admin can
  change it), and the last admin can't be made a User, so nobody can lock
  everyone out.
- **A new admin** gets the Admin page in their drawer on their next load.

### 3. What a viewer sees (Q-V1, Q-V2)

- **Tabs:** Timeline, Journal, Map. No Today tab.
- **Where they land:**
  - Signing in lands on the trip's timeline, not Today.
  - A link to `/today` (or Weather, Packing, Currency, Time zones,
    Documents) goes to the timeline instead.
- **Timeline:** no Plan / Stays / Travel switch; it's always the plan.
- **Drawer:** no Trip tools section at all, so no Weather, Currency, Time
  zones, Packing, Documents or Share.
- **Stays as they are:** day pages, an entry's own page (opened from the
  timeline), trip search and the map, as now (Q-V1).
- **On the server** (Q-V2): weather and packing refuse viewers (403), like
  documents already do, so hiding them isn't only cosmetic. Currency and
  time zones never touch the server.

### 4. The map for viewers: activities and public memories only (Q-M1)

Option (a): for everyone who's a viewer, the map shows only activities
and public memories. It's done on the server, so it isn't only hidden:
a viewer's trip read (the same one the phone saves for offline) has:
- **no points of interest at all** (they're on the map only);
- **stays and travel legs without their places:** a stay still shows on
  the timeline by name, with its dates, and a leg with its title and times,
  but neither has an address, coordinates, photo or map.
- Activities and public memories keep their places, as now.

So a viewer's map has activity pins and, with the Filter's Journal, public
memories. The Filter menu offers a viewer only Everything and Journal, and
the List shows only those. The entry page for a stay or leg shows no
place, map or Directions for a viewer. A viewer's export follows the same
read (no places on stays and legs, no points of interest).

## Phases

- **Phase 72 — quiet offline.**
  - **Scope:**
    - The `apiClient` read rule.
    - Friendly wording for writes, and repeats folded into one toast.
    - `offlineOk` on `/config`, `/timezone`, packing and documents.
    - "Needs a connection" on Packing and Documents.
  - **Tests:**
    - The interceptor: an offline GET never toasts; an offline write toasts
      the friendly message once.
    - Packing and Documents offline show their note.
  - **E2E:** go offline and move through every page, including an entry's
    page with mini maps and coming back to the app; no "Network Error"
    toast anywhere.
- **Phase 73 — making someone an admin.**
  - **Scope:** `PATCH /admin/users/:id` with the safeguards; the Role
    choice (Admin / User) in the Admin page's table, confirmed first.
  - **Tests:**
    - Making and removing an admin.
    - Refused for your own row and for the last admin.
    - A non-admin gets 403.
    - The table's choice and its confirm; your own row has none.
- **Phase 74 — what a viewer sees.**
  - **Scope:**
    - Viewer tabs; landing on the timeline; redirects from Today and the
      tools.
    - No views switch; no Trip tools.
    - The server refuses viewers weather and packing.
  - **Tests:**
    - A viewer's tabs, landing, redirects, timeline and drawer.
    - An editor's unchanged.
    - Weather and packing 403 for a viewer.
  - **E2E:** the seed viewer at 375 px.
- **Phase 75 — the map for viewers.**
  - **Scope:**
    - A viewer's trip read (and export): no points of interest; stays and
      legs without their places.
    - The Filter offers a viewer Everything and Journal only.
    - A stay's or leg's page copes with no place.
  - **Tests:**
    - A viewer's read has none of those places; an editor's has all.
    - A viewer's export follows the read.
    - A viewer's map has only activity pins and public memories, and the
      List matches.
    - A stay's page for a viewer has no place.
  - **E2E:** the seed viewer's map at 375 px.

## Built

### Phase 72 (2026-10-07): quiet offline

`make verify` green (260 API + 465 UI tests). New e2e
`offline-toasts.spec.js`: offline, through every page (an entry's page
with its mini maps, and coming back to the app), no error toast. Before
the fix, Packing, Documents and an entry's page each toasted "Network
Error".
- **`apiClient`:** a request that got no response stays quiet when it's a
  read, or a write the outbox keeps (`offlineOk`). Any other write says
  "You’re offline, so that wasn’t saved." (`OFFLINE_WRITE`). Background
  housekeeping stays quiet as before. A read the server answers with an
  error still toasts.
- **Repeats:** a notification already showing (same type and words) isn't
  added again. The error toast holds one message, so repeats there replace
  it.
- **Packing:** offline, "Your packing list needs a connection. It loads
  when you’re back online." It now reloads when the connection comes back,
  and so do Documents, whose own offline banner already says they need a
  connection.
- `offlineOk` on `/config`, `/timezone`, packing and documents, for what
  they are, though the read rule covers them now anyway.

## Open questions (Run stage 17)

- **Q-T1. Offline:** reads never toast; writes say "You're offline, so
  that wasn't saved" (once). Recommendation: **yes.**
  - **Answer:** yes (2026-10-07).
- **Q-R1. "Change a user's role":** the role on a trip (editor or viewer,
  changed by the trip's owner), making someone an admin of the app (by an
  admin), or both? Recommendation: **both**, as above.
  - **Answer:** the app's admin only: set Admin or User in the Admin page's table of users (e.g. invite yourself, then make that user an admin). No changing editor / viewer (2026-10-07).
- **Q-R2. Admin safeguards:** you can't remove your own admin, and there's
  always at least one admin. Recommendation: **yes.**
  - **Answer:** see Q-R1; the safeguards are kept as recommended (2026-10-07).
- **Q-V1. A viewer keeps** day pages, an entry's own page, trip search and
  the map, and loses Today, the Stays / Travel views and every Trip tool.
  Is that the line? Recommendation: **yes.**
  - **Answer:** yes (2026-10-07).
- **Q-V2. Enforce it on the server too:** weather and packing refuse
  viewers, as documents do. Recommendation: **yes**; otherwise it's only
  hidden.
  - **Answer:** yes (2026-10-07).
- **Q-M1. The map for viewers:** (a) by kind for all viewers, (b) a "Hide
  from viewers" switch per entry, (c) a per-trip setting, or not now? And
  what should be hidden: stays, travel, points of interest, memories?
  Recommendation: decide what to hide first; (a) if it's "where we sleep".
  - **Answer:** (a), hiding stays, travel and points of interest: viewers see only activities and public memories (2026-10-07).
