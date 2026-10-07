# Run stage 13 — a full page for an entry's details

Asked 2026-10-06 (Julian), on branch `details-page`: instead of expanding a
row in place, tapping an activity, stay or travel leg opens a full screen
with its details.

**Decisions (answered 2026-10-06):** every recommendation, and the
confirmation number moves to the top of the page (Q-D2).

### Where we are

- **Four ways in, three ways of showing details:**
  - The day page and the Today tab expand a row in place
    (`TimelineEntry` → `ExpandedDetails`: the hero fade, then
    `EntryDetails`). On the day page, an editor's Edit / Move / Delete buttons
    sit at the bottom of the expanded row.
  - The trip page's Stays and Travel views open `BookingDetailsDialog`, a
    modal with the same `EntryDetails`.
  - Trip search links to the day with `?open=<entry key>`, which expands and
    scrolls to that row.
  - A map pin's info window links to the entry's day.
- **What a detail shows** comes from one place, `describeEntry()`: title,
  times and zones, facts (carrier, seat, room, check-in/out, duration),
  confirmation number (copyable), notes (Markdown), places (each with a
  mini map and Maps link), hero photo, "Edited by".
- **Entry keys are positional** (`travel-0-dep`), but every activity, stay and
  leg has a stable id, which is what a URL should use.
- **The edit forms** (Activity, Stay, Travel) are dialogs owned by the day page
  and the trip page; deleting asks in a confirm dialog; conflicts (409) are
  handled in `timelineSlice`.

### Design (assuming the recommended answers)

**Routes** (Q-D1): a detail is a page with its own address, so the phone's back
gesture, reloads and links all work:
- `/trips/:tripId/activities/:itemId`
- `/trips/:tripId/stays/:stayId`
- `/trips/:tripId/travel/:travelId`

The page finds the entry in the loaded trip (online or the phone's saved
copy), so it works offline. If the entry is gone (deleted, or someone else
removed it), it says so, with a link to the trip.

**The page** (`EntryPage`, one page for all three kinds; Q-D2):
- **Top bar:** ← back to where you came from, or to the entry's day if opened
  directly, in ☰'s place, like the tool pages (Q-D3). The trip name stays as
  the title. The Timeline / Today / Journal / Map tab bar stays at the bottom
  (Q-D4).
- **Hero:** the place photo, large, fading into the page (the existing
  `HeroFade`), with the icon, title and the day under it.
- **Confirmation number** next (Q-D2), large, with copy: it's what a desk
  asks for.
- **When:** big, after the confirmation. An activity: its time or span. A stay: check-in and
  check-out with the number of nights. A leg: Departs and Arrives as two
  blocks, each with its place's zone when it differs from the trip's, and the
  duration between them.
- **Then, as now:** the facts, notes, each
  place with its mini map and "Open in Maps", and "Edited by".
- **Actions** (editors; Q-D5): Edit and Delete in the page. Edit opens the same
  form as today (a dialog over the page); Delete asks, then returns to the
  day. Move up / down stays on the day page, where you can see the order.
  Viewers see no actions. Offline greys them, as now.
- **Arrival rows** ("Arrive · Zürich") open the same leg's page.

**Every way in opens the page** (Q-D6):
- **Day page and Today:** a row is a link to its page. No more expand/collapse,
  and the chevron becomes →. Every row opens, even a bare activity, because
  that's where Edit and Delete now live.
- **Stays and Travel views:** a card opens the page; `BookingDetailsDialog`
  goes.
- **Trip search:** a result opens the entry's page directly. An old
  `?open=` link still works by redirecting to it.
- **Map:** a pin's info window gets "Details" (the page) beside the day link.

**Not in this stage** (Q-D7): swiping between a day's entries on the details
page.

### Phases

- **Phase 62 — the details page (view).** ✅ (2026-10-06)
  - **Scope:** the three routes, `EntryPage` with the design above (no
    actions yet); looking an entry up by id; the "it's gone" state; offline
    from the saved copy.
  - **Tests:** each kind shows its when, facts, confirmation, notes and
    places; a leg shows both ends with zones and duration; a stay shows its
    nights; an arrival key resolves to its leg; a missing id shows "gone"; ←
    goes back, or to the day when opened directly; works from the saved copy
    offline.
- **Phase 63 — actions on the page.** ✅ (2026-10-06)
  - **Scope:** Edit (the existing forms) and Delete (confirm, then back to the
    day) for editors; hidden for viewers; greyed offline; a conflict on save
    behaves as on the day page.
  - **Tests:** edit saves and the page shows the change; delete returns to the
    day and the entry is gone; viewers have no actions; offline greys them;
    409 shows the conflict notice.
- **Phase 64 — every way in opens the page; expand/collapse goes.** ✅ (2026-10-06)
  - **Scope:** day page and Today rows become links (Move up / down stays on
    the day page); Stays/Travel cards; search results; `?open=` redirect; the
    map's "Details"; remove `ExpandedDetails`, `BookingDetailsDialog` and the
    expand state.
  - **Tests:** a row opens its page and Back returns to the day at the same
    scroll position; Stays/Travel cards open pages; search opens the page;
    an old `?open=` link redirects; the map's Details link.
  - **E2E:** day → entry page → back; screenshots of an activity, a stay and a
    flight at 375 px.

### Built (2026-10-06): Phases 62–64

Built as planned, one commit per phase, `make verify` green (246 API + 398
UI tests). E2E: everything passes except the specs that sign in as
`pripri@example.com`, whose password in the dev database was changed by hand
(`make reset-db` fixes it). Screenshots `04` (a flight), `04a` (a stay) and
`04b` (an activity).

**Details:**
- `features/entry/`: `entries.js` (the addresses, and finding an entry by id
  in the loaded trip), `EntryPage.jsx` (the page; `EntryView` is the layout),
  `EntryActions.jsx` (Edit and Delete).
- The page leaves out facts it already shows above them: Check-in/out,
  Departs/Arrives and Duration are in "When", and a leg's mode and carrier
  are in its heading.
- Each place shows its mini map on the page (`MiniMap`), as it did in the
  place picker.
- **Day page:** a row is a link. An activity's ⋯ has Move up / Move down
  (only on a day with more than one activity). Add activity and Edit day
  stay. Edit and Delete for stays and legs moved to their pages, so the
  day page no longer has the stay and travel forms.
- **Trip page:** a Stays/Travel card opens the page; the forms there only
  add now.
- **Today:** rows are links, and Next up and Tonight have "Details".
- **Removed:** `BookingDetailsDialog`, `ExpandedDetails`, the `EntryDetails`
  component (its pieces `ConfirmationNumber`, `PlaceRow` and `EditedBy`
  stay), and the dialog's hero photo, which nothing else used.
- Tests that opened a row now go through `src/test/tripRoutes.jsx`, the
  trip's routes as App.jsx has them, so they tap from a row to its page.

### Open questions (Run stage 13)

- **Q-D1. A real page (its own address) or a full-screen overlay?**
  - (a) A page with its own URL: the phone's back gesture works, a reload
    stays on it, and search/map can link straight to it.
  - (b) A full-screen sheet over the day: no URL, so back-swipe and reloads
    leave it.
  - Recommendation: **(a)**.
  - **Answer:** as recommended, (a) (2026-10-06).
- **Q-D2. One page for all three kinds**, laid out per kind as above (when
  first, then facts, confirmation, notes, places)? Anything you want added or
  moved up, e.g. the confirmation number above the times while travelling?
  - **Answer:** yes, and move the confirmation number to the top (2026-10-06).
- **Q-D3. Where's the back arrow?** The tool pages have ← in ☰'s place (top
  left); the day page has ☰ on the left and ← top right.
  - (a) Top left, in ☰'s place, like the tool pages: this is a drill-in.
  - (b) Top right, like the day page, keeping ☰.
  - Recommendation: **(a)**.
  - **Answer:** as recommended, (a) (2026-10-06).
- **Q-D4. Keep the bottom tab bar** (Today / Timeline / Journal / Map) on the
  details page? Recommendation: **yes**, so the rest of the trip is one tap
  away; a full-screen page without it is the alternative.
  - **Answer:** as recommended: yes (2026-10-06).
- **Q-D5. Which actions on the page?** Recommendation: **Edit and Delete** on
  the page, with **Move up / down left on the day page** (moving only makes
  sense when you can see the order). Do you also want Move on the details
  page, or the day page's rows to keep their own Edit/Delete?
  - **Answer:** as recommended (2026-10-06).
- **Q-D6. Every way in opens the page** (day, Today, Stays/Travel views,
  search, map)? Including bare activities with nothing but a title?
  Recommendation: **yes to all**.
  - **Answer:** as recommended: yes to all (2026-10-06).
- **Q-D7. Swiping left/right on the details page** to the day's previous or
  next entry: now, later, or never? Recommendation: **later** (the day page
  already swipes between days, and two swipes stacked is easy to get wrong).
  - **Answer:** as recommended: later (2026-10-06).
