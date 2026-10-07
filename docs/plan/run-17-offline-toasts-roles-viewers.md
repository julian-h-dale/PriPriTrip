# Run stage 17 — quiet offline, changing roles, what viewers see

Asked 2026-10-07 (Julian), after trying Run stage 16 on the phone:
1. In airplane mode, a lot of "Network Error" toasts, even where the page
   is showing the phone's saved copy.
2. Change a user's role, and make a user an admin.
3. Viewers see only the Timeline, Journal and Map: no Today tab, no Stays
   or Travel views on the timeline, no Trip tools in the drawer.
4. How much work it would be to limit what viewers see on the map.

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

### 2. Changing roles (Q-R1, Q-R2)

**On a trip** (the owner, in Share trip):
- Each member's row gets a role menu: Editor or Viewer.
- New endpoint: `PATCH /trips/:id/members/:userId` with `{ role }`, owner
  only.
- The owner's own row can't change.
- The change takes effect on that person's next load.

**In the app** (an admin, on the Admin page):
- Each user's row gets **Make admin** / **Remove admin**, asking first.
- New endpoint: `PATCH /admin/users/:id` with `{ isSuperuser }`, behind
  `current_superuser` like the rest of `/admin`.
- **Safeguards:** you can't remove your own admin, and the last admin
  can't be removed, so nobody can lock everyone out.

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

### 4. Limiting what viewers see on the map: effort (Q-M1)

Hiding pins only in the app is cosmetic: the trip the viewer's phone
downloads still has every place, and a viewer can see stays' addresses on
the timeline anyway. A real limit goes on the server, the way confirmation
numbers are stripped from a viewer's read today. Three sizes:

- **(a) By kind, for all viewers** (e.g. no stays, or no stays and no
  travel, for anyone who's a viewer):
  - **Server:** a viewer's trip read leaves out those places (or their
    locations).
  - **App:** the map, timeline and entry pages cope with places that have
    no location (they already do for places that were never located).
  - **Effort:** about one phase, **½–1 day**.
- **(b) A switch on each entry**, "Hide from viewers":
  - **Server:** a column on stays, activities, legs and points of interest
    (migration), the switch in each form, and a viewer's read that drops
    hidden entries.
  - **Decision needed:** the export question (does a viewer's export skip
    them too? yes).
  - **Effort:** **2 phases, about 2 days**.
- **(c) A per-trip setting** for the owner, "Viewers see: everything /
  plans only / …" in Share trip: (a) with a choice.
  - **Effort:** **about 1 day**.

Recommendation: decide what you want hidden before building any of these;
(a) covers "don't show viewers where we sleep" cheaply.

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
- **Phase 73 — changing roles.**
  - **Scope:**
    - Trip: `PATCH …/members/:userId` and the role menu in Share trip.
    - App: `PATCH /admin/users/:id` with the safeguards, and Make / Remove
      admin on the Admin page.
  - **Tests:**
    - Owner changes a member's role; an editor or viewer can't (403).
    - The owner's own role can't change.
    - Making and removing an admin; refused for yourself and for the last
      admin.
    - A non-admin gets 403.
    - The UI for each.
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
- **(Later) Phase 75 — the map for viewers,** once Q-M1 is answered.

## Open questions (Run stage 17)

- **Q-T1. Offline:** reads never toast; writes say "You're offline, so
  that wasn't saved" (once). Recommendation: **yes.**
  - **Answer:**
- **Q-R1. "Change a user's role":** the role on a trip (editor or viewer,
  changed by the trip's owner), making someone an admin of the app (by an
  admin), or both? Recommendation: **both**, as above.
  - **Answer:**
- **Q-R2. Admin safeguards:** you can't remove your own admin, and there's
  always at least one admin. Recommendation: **yes.**
  - **Answer:**
- **Q-V1. A viewer keeps** day pages, an entry's own page, trip search and
  the map, and loses Today, the Stays / Travel views and every Trip tool.
  Is that the line? Recommendation: **yes.**
  - **Answer:**
- **Q-V2. Enforce it on the server too:** weather and packing refuse
  viewers, as documents do. Recommendation: **yes**; otherwise it's only
  hidden.
  - **Answer:**
- **Q-M1. The map for viewers:** (a) by kind for all viewers, (b) a "Hide
  from viewers" switch per entry, (c) a per-trip setting, or not now? And
  what should be hidden: stays, travel, points of interest, memories?
  Recommendation: decide what to hide first; (a) if it's "where we sleep".
  - **Answer:**
