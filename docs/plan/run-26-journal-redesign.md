# Run stage 26 — the journal as a timeline; invite people by email

Julian (2026-10-08): the card view won't scale once a trip has memories
across many days. Redo the journal in the app's timeline style: a plain
day divider, then that day's memories in order. Each memory should be
mostly its photo, with a short preview of the words over it. Tapping it
opens the big photo and the full text. Color each memory by who wrote it.
The time goes in the full view. Swap "Location attached" for a real place
name, looked up on the server when the memory is saved. Keep the accuracy
and the Maps link.

Also: drop join codes. The owner gets an **Invite** button instead: type
an email and pick editor or viewer. If no account has that email, show an
error. If one does, add that person with the chosen role.

**Status: in progress.** Open questions answered 2026-10-08. Branch `journal-redesign` (off `main` at `de5a6e7`).

## Where we are

- **Journal** (`features/journal/JournalPage.jsx`): `journalDays()` puts
  memories into before / each day / after groups, by the date in the
  memory's own `zone`. Each memory is a `Card` with its text,
  `PhotoStrip` (80 px thumbnails, tap → `PhotoViewer`), a time line,
  public badge, location link and sync/stuck states. Edit/Delete is in a
  `RowMenu`.
- **Ordering field:** `Memory.created_at` is the phone's own stamp (when
  Save was tapped, clamped if it's more than 10 min in the future).
  `received_at` is the server's. The server already sorts by
  `created_at, id`. The client keeps that order, but memories still in the
  outbox are merged in by the slice.
- **"Chrono":** there's no chrono library. The timeline is our own
  (`RailDot.jsx`, the rail plus one dot per row), built after we turned down
  `react-chrono` on 2026-10-02 (React 18). The journal will reuse
  `RailDot`.
- **Location:** `lat/lng/accuracy` on the memory. `locationLabel()` says
  "Near <trip place>" within 250 m of a stay/activity, else "Location
  attached (±N m)".
- **Server → Google:** the agreement is "Google Places runs in the
  browser". The only exception is the backfill script
  (`google_places_server.py`), which reuses the browser key server-side.
  A lookup on save would be the **first request-path exception**.
- **Authors:** `UserRecord.name` exists (default ""). `MemoryRead` only
  sends `authorEmail` and `mine`.
- **Sharing:** `trips.view_code` / `trips.edit_code`, `POST /trips/join`,
  `JoinTripDialog` on the trips list, and `ShareTripDialog` (two codes plus
  "Shared with", with Remove). `trip_members(trip_id, user_id, role)`
  stays exactly as it is.

## Design

### Journal layout

```
 Saturday 14 June ─────────────────────────   ← day divider (sticky)
 │
 ●  ┌──────────────────────────────────┐      ← dot + left edge in the
 │  │                                  │        author's color
 │  │            photo (4:3)           │
 │  │                          ⧉ 3     │      ← "3 photos" badge
 │  │▓▓ Best schnitzel of the trip,  ▓▓│      ← scrim + 2 lines of text
 │  │▓▓ PriPri ordered a second…     ▓▓│
 │  └──────────────────────────────────┘
 ●  ┌──────────────────────────────────┐      ← no photo: a text tile,
 │  │ Missed the train by 30 seconds.  │        tinted in the author's
 │  │ Worth it for the pastry.         │        color, up to 4 lines
 │  └──────────────────────────────────┘
 Sunday 15 June ───────────────────────────
```

- **Day divider:** the `formatDayHeading` date, still a link to the day
  page, sticky at the top while you scroll its memories. "Before the trip"
  and "After the trip" stay as their own dividers.
- **Order:** sorted by `createdAt`, then `id`, inside each day, on the
  client too, so a memory waiting in the outbox shows in its proper place.
- **Photo tile:** the first photo, full width, fixed 4:3, `object-cover`,
  using the display copy (falling back to the thumbnail). At the bottom, a
  black-to-clear scrim with white text clamped to 2 lines (3 at large
  text). These colors are the same in light and dark mode: it sits on a
  photo, not on the theme. With more than one photo, a "⧉ N" badge.
- **No time on the tile** (answer 5, taking the original ask): the time
  is only in the full view.
- **Text-only tile:** words on a faint tint of the author's color, up to
  4 lines.
- **Author color:** the rail dot plus a 3 px left edge on the tile. Colors
  are handed out per trip in a fixed order: owner `series-1`, then members
  in the order they joined (`series-2…8`). That way two people on one trip
  never share a color, and you always have the same one on that trip. A
  small legend under the title ("● You ● PriPri ● Sam") explains them.
- **States on the tile:** small badges in the corner (waiting to sync,
  couldn't upload, public). The detail and buttons move to the full view.
- **Images load lazily.** With "saved copies only", a photo that isn't
  saved shows the text tile instead.

### The full view (tap a tile)

A full-screen page at `/trips/:id/journal/:memoryId`, so Back closes it
(the same pattern as the entry page, Run 13):

- Photo(s) at the top, swiping between them. Tap a photo for today's
  `PhotoViewer` (full quality, pinch zoom, save to phone, retry/remove for
  stuck photos).
- The full text.
- **Details:** author (with color dot); time on the clock where it was
  written ("8:14 PM, Sat 14 June", plus "· Vienna time" when that isn't the
  trip's zone); "edited".
- **Place:** name and area, "±12 m", **Open in Maps**.
- Public badge, sync/stuck banners with Try again / Remove, and Edit /
  Delete for your own memories.

### The place name, on the server

- New nullable columns on `memories`: `place_name` ("Café Central") and
  `place_area` ("Innere Stadt, Vienna"), migration `0016`. `MemoryRead`
  gets `location.placeName` / `location.placeArea`.
- **When:** after a memory with a location is created, as a FastAPI
  background task once the response has gone out. A slow or failed lookup
  never delays or fails a save, and the phone's offline outbox works the
  same as now. The name appears the next time the journal loads.
  Removing the location clears it.
- **How: Google Places Nearby Search** (answer 1) with the existing key,
  through `google_places_server.py`, which now has a request-path caller.
  Search a radius of `clamp(accuracy, 25, 150)` m, ranked by distance, and
  take the closest result's display name and `shortFormattedAddress`
  locality. If nothing's in range, area only (from the same response, or
  left empty). Best effort, a 5 s timeout, errors swallowed, like
  `google_places_server.py`.
- **Label order** in the UI: a trip place within 250 m ("Near Hotel
  Bern"), else `placeName · placeArea`, else today's "Location attached".
- A one-off `make backfill-places` names memories saved before this
  change.

### Invite by email (the owner's Share dialog)

- **Removed:** `POST /trips/join`, the four `…/view-code` / `…/edit-code`
  endpoints, `JoinTripDialog`, the trips list's **Join trip** button, and
  both code sections in the Share dialog. People who already joined keep
  their role.
- **Added:** `POST /trips/{id}/members` with `{ email, role }`, owner only
  (`get_owned_trip`). The email match ignores case and spaces.
  - No account → **404** "No account with that email". The dialog shows it
    inline under the field.
  - A trip member who isn't the owner → 403, a stranger → 404 (the
    existing `get_owned_trip` behavior).
  - The owner's own email → **409** "That's you".
  - Already a member → their role changes to the new one (**200**).
  - Otherwise added (**201**). It returns the `MemberRead`.
- **Share dialog:** an email field, a Can view / Can edit choice, and an
  **Invite** button. Below that, "Shared with" as now (name, then email),
  plus a role switch on each row (`PATCH /trips/{id}/members/{userId}`) so changing a role doesn't
  take remove-and-re-add.
- The invited person isn't notified. The trip shows on their trips list the
  next time it loads.

## Phases

### Phase 93 — invite by email; no more join codes ✅

Built 2026-10-08. A member who isn't the owner gets 403 (not 404) on the
owner-only endpoints, as before. The Share dialog's member row keeps the role
picker and Remove together, so they wrap as one group at 375 px.

Scope: the endpoints and dialog above, removing the join paths, and tests.

Tests:
- API: invite as viewer / editor → member with that role. Unknown email →
  404, nothing added. Different case or spaces → matches. Own email → 409.
  Re-invite with the other role → role changed, still one row. A
  non-owner (editor, viewer, stranger) → 404. `PATCH` changes a role.
  `/trips/join` and the code endpoints → 404/405.
- UI: Invite adds the row. The 404 message shows under the field. The role
  switch works. No Join trip button, no codes.
- Phone width: the Share dialog at 375 px, light and dark.

### Phase 94 — place names for memories (server)

Scope: migration 0016, the lookup module, the background task on create,
clearing it on location removal, `MemoryRead` fields, `make
backfill-places`, and the label order in the UI (kept in the current card
until Phase 95).

Tests:
- With the Google call faked: a memory with a location gets
  `placeName/placeArea`. None in range → area only. A Google error or
  timeout → the save still succeeds with no name. A memory without a
  location makes no call. Removing the location clears the name. A retried
  create (same id) doesn't look it up again.
- `locationLabel` order: trip place, then place name, then "attached".

### Phase 95 — the journal timeline

Scope: day dividers, the rail, client sort, author colors and legend,
photo and text tiles, state badges, empty/loading states. Tap → Phase 96's
route (an interim open of the current viewer until then).

Tests:
- Ordering: memories (including an outbox one) sort by `createdAt` within
  a day. Before/after groups.
- Colors: owner first, members by join order. Stable across reloads.
- Tile: photo with an overlay clamped to 2 lines. "⧉ N" for more than one
  photo. Text tile without a photo. Badges for pending / stuck / public.
- Phone width at 375 px, light and dark, normal and large text, with real
  photos (light and dark ones) to check the overlay is readable.

### Phase 96 — a memory's full view

Scope: the route and page above. Edit/Delete/Remove and stuck handling move
here from the card. Back goes to the journal at the same scroll position.

Tests:
- Opens from a tile and by URL. Back returns to the journal. Full text,
  time with its zone note, author, place, accuracy, Maps link. Edit/Delete
  only for your own. Delete returns to the journal. Stuck banner with Try
  again / Remove. A viewer sees only public memories, so a URL for a
  private one → not found.
- Phone width at 375 px, light and dark, large text.

## Open questions — answered (Julian, 2026-10-08)

1. **Server calling Google:** yes. Use the Places search. The backfill
   script's code (`google_places_server.py`) is the starting point.
   → Google Places Nearby, as in Design.
2. **Several photos:** the first photo with a "⧉ N" badge.
3. **Names vs emails:** the name, falling back to the email.
4. **Full view:** a page at `/trips/:id/journal/:memoryId`.
5. **Time on the tile:** not answered. Going with the original ask: no time
   on the tile, only in the full view.
6. **Join-code columns:** not answered. Going with the recommendation: leave
   `view_code` / `edit_code` in the table, unused (no migration).
7. **Role switch in the list:** yes (`PATCH`).
8. **Phase order:** invites → place names → timeline → full view.
