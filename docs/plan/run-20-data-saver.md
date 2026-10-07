# Run stage 20 — a "saved copies only" switch (data saver)

Asked 2026-10-07 (Julian): a switch in the drawer that stops the app's
network calls so it uses only what's saved on the phone. Then nothing loads
on mobile data unless you want it to.

**Status: planned.** All questions answered (2026-10-07).

## Where we are

The app already behaves well with **no** connection. One flag drives it all:
`network.online` (the browser's online/offline events), read in 18
places. When it's false:
- the offline bar shows "Offline · saved copy from …";
- trips, the journal and weather come from the phone's saved copies
  (`tripCache`, IndexedDB);
- the trip isn't reloaded when the app comes back to the front;
- the map tab becomes a list with Directions;
- reads that fail never toast; writes say they weren't saved, except
  memories and photos, which wait in the outbox;
- photos already wait for Wi-Fi on their own (Run 5).

What's missing is a way to be in that state **on purpose**, with a signal.

## Design (assuming the recommended answers)

### The switch

- **"Use saved copies only"** in the drawer, **for everyone**, viewers
  included (Q-D1), with a short line under it: "Nothing loads over the
  network. Turn off to refresh."
- It's a **setting for this phone**, not for the account or the trip:
  stored in `localStorage` and **remembered until you turn it off**, across
  closing and reopening the app (Q-D2).
- **Manual only** (Q-D5): the app never turns it on by itself.

### How it works: "offline on purpose"

- `networkSlice` gains `savedOnly`. One selector, `selectOnline` =
  `online && !savedOnly`, replaces the 18 direct reads of
  `network.online`. So every page that already handles offline handles
  this too, with no new code paths.
- **`apiClient` refuses every request before it leaves the phone** while
  `savedOnly` is on, failing the same way a request with no connection
  fails. Reads come from saved copies and don't toast. That's the
  guarantee: nothing goes out, even if a page forgot to check.
- **What waits on the phone instead** (Q-D3):
  - **memories** (the journal outbox, as offline);
  - **photos** (the outbox; the Upload button is off until the switch is);
  - **analytics** (its own queue, Run 19).
- **What's refused** (Q-D3): every edit to the trip (activities, stays,
  travel, days, points of interest, sharing, documents), with "Turn off
  saved copies only to save this", so nothing is silently lost.
- **Packing** (Q-D6) is your own list, not the trip: its changes wait on the
  phone like memories, once Run 21 (Phase 84) gives it a queue. Until then
  they're refused like trip edits.
- **Not our API:**
  - Google Maps: the map tab already shows its list from the online flag.
    **Mini maps on entry pages and the hero photos (Google-hosted) don't
    look at it today**: offline they just fail to load. They'll read
    `selectOnline` and not ask at all. Place search in the forms is off
    too.
  - Currency rates use the saved rate (as offline now).
- **The bar** says "Saved copies only · from Oct 7, 2:33 PM", with a
  **Refresh once** button (Q-D4): the open trip and the trips list reload,
  and the memories and analytics waiting are sent (Q-D7); photos still
  wait for their own Upload button. Then it's back to saved copies.

### Before you rely on it

The phone already saves the trips list, each trip opened, and any trip
that hasn't ended (fetched in the background). Turning the switch on
first saves everything it can, if there's a connection, so nothing is
missing later.

## Phases

- **Phase 80 — the switch.**
  - **Scope:**
    - `savedOnly` in `networkSlice`, persisted; `selectOnline` replacing
      the direct reads.
    - The `apiClient` guard; trip edits refused with the message.
    - Mini maps, hero photos and place search follow `selectOnline`.
    - Analytics held while it's on.
    - The drawer switch (everyone), and the bar's wording.
    - Saving what it can on the way in.
  - **Tests:**
    - With it on: no request leaves `apiClient`; pages show saved copies;
      the map tab is the list; no mini maps or hero photos; no toasts.
    - A memory and a photo queue; an activity edit and a packing tick are
      refused with the message; analytics stays queued.
    - It's remembered across a reload; a viewer has the switch too.
    - Turning it off reloads the open trip and sends what waited.
  - **E2E:** turn it on, then move through every page while counting
    network requests: none to the API, Google or Umami.
- **Phase 81 — Refresh once.**
  - **Scope:** the bar's button: the open trip and trips list reload, the
    waiting memories and analytics are sent, then back to saved copies.
  - **Tests:** one round of requests (trip, list, memories, analytics; no
    photos), then none again.

## Open questions

- **Q-D1. Who gets the switch?**
  - **Answer:** Everyone (Julian, 2026-10-07).
  - **Resolved:** in every drawer, viewers included.
- **Q-D2. Remembered after the app is closed?**
  - **Answer:** Yes.
  - **Resolved:** on until turned off, per phone (`localStorage`).
- **Q-D3. Edits while it's on?**
  - **Answer:** No edits to the trip; memories, photos and analytics all
    queue.
  - **Resolved:** trip edits are refused with a message; memories, photos
    and analytics wait on the phone.
- **Q-D4. A "Refresh once" button on the bar?**
  - **Answer:** Yes (Phase 81).
- **Q-D5. Turn it on by itself on mobile data?**
  - **Answer:** No. Manual only.
- **Q-D6. Packing changes while it's on?** Packing is your own list, not
  the trip. Run 21 (Phase 84) saves it on the phone with a queue for
  ticks and adds, like memories.
  - (a) *Recommended:* treat it like memories: ticks, adds and deletes
    wait on the phone and go when the switch is off. (Phase 80 refuses
    them until Run 21's queue exists, then they queue.)
  - (b) Treat it like the trip: refused while the switch is on.
  - **Answer:** (a) (Julian, 2026-10-07). Queued like memories once Phase 84 exists; refused before that.
- **Q-D7. What does Refresh once send?**
  - (a) *Recommended:* the trip reload, plus the memories and analytics
    waiting (both small). Photos still wait for their own Upload button.
  - (b) Only the trip reload; everything waiting stays until the switch is
    off.
  - **Answer:** (a) (Julian, 2026-10-07). Trip reload plus waiting memories and analytics; not photos.
