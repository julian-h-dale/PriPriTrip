# Run stage 20 — a "saved copies only" switch (data saver)

Asked 2026-10-07 (Julian): a switch in the drawer, for editors and owners,
that stops the app's network calls so it uses only what's saved on the
phone. Then nothing loads on mobile data unless you want it to.

**Status: planned. Open questions below.**

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

- **"Use saved copies only"** in the drawer, with a short line under it:
  "Nothing loads over the network. Turn off to refresh."
- It's a **setting for this phone**, not for the account or the trip:
  stored in `localStorage` and remembered across launches (Q-D1, Q-D2).

### How it works: "offline on purpose"

- `networkSlice` gains `savedOnly`. One selector, `selectOnline` =
  `online && !savedOnly`, replaces the 18 direct reads of
  `network.online`. So every page that already handles offline handles
  this too, with no new code paths.
- **`apiClient` refuses requests before they leave the phone** while
  `savedOnly` is on, failing the same way a request with no connection
  fails. Reads come from saved copies and don't toast. That's the
  guarantee: nothing goes out, even if a page forgot to check.
  - **Allowed through:** none, except what Q-D3 decides about writes.
- **Not our API:**
  - Google Maps: the map tab already shows its list from the online flag.
    **Mini maps on entry pages and the hero photos (Google-hosted) don't
    look at it today**: offline they just fail to load. They'll read
    `selectOnline` and not ask at all. Place search in the forms is off
    too.
  - Currency rates use the saved rate (as offline now).
  - Analytics stays queued on the phone (Run 19) until the switch is off.
- **The bar** says "Saved copies only · from Oct 7, 2:33 PM", with a
  **Refresh once** button (Q-D4): one trip reload, then back to saved
  copies.

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
    - The `apiClient` guard.
    - The drawer switch, and the bar's wording.
    - Saving what it can on the way in.
  - **Tests:**
    - With it on: no request leaves `apiClient`; pages show saved copies;
      the map tab is the list; no toasts.
    - It's remembered across a reload.
    - Turning it off reloads the open trip.
  - **E2E:** turn it on, then move through every page while counting
    network requests: none to the API, Google or Umami.
- **Phase 81 — Refresh once** (if Q-D4 is yes): the bar's button, one trip
  reload, then back to saved copies.

## Open questions

- **Q-D1. Who gets the switch?**
  - (a) *Recommended:* everyone, viewers included. It's about this phone's
    data plan, not about editing, and viewers use data too.
  - (b) Editors and owners only, as asked.
  - **Answer:**
- **Q-D2. Remembered after the app is closed?**
  - (a) *Recommended:* yes, until you turn it off. A roaming trip lasts
    days, and forgetting it once costs data.
  - (b) No: it resets each time the app opens.
  - **Answer:**
- **Q-D3. Edits while it's on?**
  - (a) *Recommended:* memories and photos wait in the outbox as offline
    (they're the field writes). Everything else (editing an activity,
    packing ticks, documents) is refused with "Turn off saved copies only
    to save this", so nothing is silently lost.
  - (b) Let small writes through (an edit is a few hundred bytes); block
    only the reads that cost data (maps, photos, refreshes).
  - **Answer:**
- **Q-D4. A "Refresh once" button on the bar?**
  - (a) *Recommended:* yes: you're on hotel Wi-Fi for a minute and want
    the latest without turning the switch off and on.
  - (b) No: turn the switch off to refresh.
  - **Answer:**
- **Q-D5. Turn it on by itself on mobile data?**
  - (a) *Recommended:* no. iPhones don't tell a web app whether it's on
    Wi-Fi or cellular (`navigator.connection` is missing in Safari), so it
    can't be done reliably. The switch stays manual.
  - (b) Where the browser can tell (Android Chrome), suggest it: "You're on
    mobile data. Use saved copies only?"
  - **Answer:**
