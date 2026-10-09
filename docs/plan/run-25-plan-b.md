# Run stage 25 — plan B (a backup plan for a day)

Julian (2026-10-08): let a day have a backup plan in case the weather
throws something off. A day's normal activities are plan A; some days
also have a plan B. Plan B is normally hidden. On the day page you can
switch to plan B: the plan A activities go and the plan B ones show in
their place. Things that come from bookings (check in, check out, depart,
arrive, staying at) show the same under both plans.

**Status: answered; building.** Julian: build both phases without stopping. Branch `alternate-days` (worktree, off `main`
at `e04da12`).

## Where we are

- A day's activities are `Item` rows (`models.py`) on a `Day`, in
  `position` order. On the wire they're `day.items` (`DayDoc.items`,
  `trip_document.py`). They're written one at a time through
  `POST/PUT/DELETE /trips/{id}/items[/{itemId}]` and `…/move`
  (`services/trips.py`), with `ItemWrite` = `ItemDoc` + `date`.
- Booking rows (check in/out, depart/arrive, staying at) are never stored.
  `buildTimeline.js` works them out at render time and merges them with
  `day.items`. So "booking rows show under both plans" is already true if
  plan B goes through the same merge.
- `day.items` is read directly in many places: `buildTimeline` (and through
  it the trip timeline, Today, search, the entry page sequence), the map
  (`buildMapMarkers.js`), the clocks (`tripZones.js`), currency
  (`tripCurrencies.js`), place suggestions (`bookingForms.js`), and export.
  Memories aren't linked to activities, so the journal isn't affected.
- `get_trip(db, trip_id, role)` already knows the reader's role, so the
  server can shape what a viewer gets.

## Design

**Storage.** `Item` gets a `plan` column, `"a"` or `"b"` (default `"a"`,
migration `0015`). Plan B items are ordinary activities: same fields, same
versioning and soft delete, same per-item endpoints. `position` is counted
within a day's plan, so moving an item never crosses from one plan to the
other.

**Wire shape: a separate list.** `DayDoc` gets `planB: list[ItemDoc]`
(default empty, left out when empty). `day.items` stays plan A only. That
way every place that reads `day.items` today (map, clocks, currency,
search, Today, the trip timeline, place suggestions) leaves plan B out
**without changing**. Only the day page reads `planB`.

- `ItemWrite` gets `planB: bool` (default false). Create adds the item to
  the end of that plan. Replace with a different `planB` moves it to the
  end of the other plan (like a date change does now). Move swaps it only
  with neighbours in the same plan.
- **Viewers never get plan B.** `get_trip` and export leave `planB` out for
  the viewer role, so it can't reach a viewer's screen, search or export.
  Owner and editors get it.
- **Import/export** round-trip `planB`, with the same rules as `items`
  (rule 3: the start time is on the day's date).

**The day page** (`DayDetailPage.jsx`), for owner and editors only:

```
┌──────────────────────────────────────────┐
│ Saturday 14 June                         │
│ Day 2 of 4                               │
│ ┌────────────┬────────────┐              │
│ │  Plan A    │  Plan B    │              │  ← only when the day has plan B
│ └────────────┴────────────┘              │
│ ● 10:00 Check out Hotel Bern             │  ← booking rows: both plans
│ ● 11:30 Train to Wengen                  │
│ ● 14:00 Alpine Museum          (plan B)  │  ← plan B items replace plan A's
│ [+ Add activity]           [✎ Edit day]  │
└──────────────────────────────────────────┘
```

- The switch shows only when the day has at least one plan B item. It's
  always there for editors on that day. Switching is only on this phone
  (nothing is saved to the trip, and nobody else sees it change).
- Under plan B, the list is `buildTimeline(trip, { plan: "b" })` for that
  date: the same booking rows, with the plan B items merged in by time,
  the same way plan A's are. `buildTimeline` with no options is unchanged.
- **Adding:** the same activity form, with a **Plan B** checkbox (editors
  only). "Add activity" while plan B is showing starts with it ticked.
  Editing an item can untick or tick it, which moves the item to the
  other plan.
- If the last plan B item is deleted or moved to plan A, the switch goes
  and the page shows plan A.
- **A plan B item's own page** (`EntryPage`): `findEntry` looks in
  `planB` too, and the page says "Plan B". Swiping up and down moves
  through that day's plan B list (booking rows plus plan B items). It
  doesn't jump to plan A items.
- Not in this run (Julian's answer 3): plan B on Today, the trip timeline,
  search, the map, weather, clocks or currency. Plan B items have no map
  pin.

**Seed data.** One seed day gets a plan B (a Wengen rainy-day option), so
the switch can be tried and the e2e has something to switch to.

## Phases

- **Phase 91 — plan B in the API.**
  - **Scope:** `Item.plan` + migration `0015`; `DayDoc.planB`;
    `ItemWrite.planB`; create/replace/move are aware of the plan;
    `get_trip`/export leave `planB` out for viewers; import accepts
    `planB`; the seed gets one plan B day. The trip document docs and
    `api/README.md` are updated.
  - **Tests:**
    - Create with `planB: true` → it's in `days[].planB` and not in
      `days[].items`; positions count within the plan.
    - Replace with a flipped `planB` → it moves to the end of the other
      plan, and the version goes up. A stale `If-Match` still gets 409.
    - Move swaps only with neighbours in the same plan. At the end of its
      plan it stays put, even when the other plan has items.
    - A viewer's `GET /trips/{id}` and export have no `planB`. An editor's
      and the owner's have it.
    - Export → import round-trips plan B. A plan B start on the wrong date
      is rejected, as plan A's is.
    - Ownership: a foreign trip's item is still 404. A viewer creating a
      plan B item gets 403/404, as for plan A.
    - Seed: the plan B day is there after `make seed`, and re-seeding
      doesn't duplicate it.
- **Phase 92 — plan B on the day page.**
  - **Scope:** `buildTimeline(trip, { plan })`; the Plan A / Plan B
    switch on the day page; the Plan B checkbox in `ActivityForm`;
    `findEntry`/`entrySequence` know about plan B; the "Plan B" label on
    the entry page. `ui/README.md` is updated.
  - **Tests:**
    - `buildTimeline` with no options = today's output (existing tests
      stay green). With `{ plan: "b" }`, the day's booking rows are the
      same and the activities are plan B's, ordered by time.
    - Day page: no switch on a day without plan B. With plan B: the switch
      shows, plan A by default; switching shows plan B items and keeps the
      booking rows; switching back restores plan A.
    - Viewers see no switch (and plan B never reaches them anyway).
    - Form: the Plan B box adds to plan B. "Add activity" under plan B
      starts ticked. Unticking an edited item moves it to plan A.
    - Deleting the last plan B item → the switch goes and plan A shows.
    - Map, Today, search and the trip timeline don't show plan B items,
      on a trip that has them.
    - Entry page: a plan B item opens, says "Plan B", and swipes stay
      within plan B for that day.
  - **E2E:** at 375 px, as an editor, on the seeded plan B day: switch to
    plan B, open an item, swipe, go back, add a plan B item. As a viewer:
    no switch. Screenshots dark and light, for a human look.

## Built

- **Phase 91 ✅ (2026-10-08).** `Item.plan` (`"a"`/`"b"`, migration
  `0015`). `Day.items` and `Day.plan_b` are filtered, read-only
  relationships; `Item.day` keeps insert order (day before items).
  `DayDoc.planB` (left out of a document when empty; the read always has
  it), `ItemWrite.planB`. Create/replace/move are aware of the plan, and
  viewers' reads and exports have no plan B. Seed: Bern's Männlichen day
  (rain: Trümmelbach Falls) and the Athens demo's Hydra day (wind: the
  museum). `tests/test_plan_b.py` (16).

## Open questions

- **Q-B1. Does the switch stay on plan B?** For example, you switch to
  plan B, open an activity, then press Back.
  - (a) *Recommended:* it stays on plan B for that day on this phone
    (saved in the browser per trip and date) until you switch back. If
    it reset, opening one activity would lose your place.
  - (b) It goes back to plan A whenever the day page opens.
  - **Answer:** (a): it stays on plan B for that day on this phone until switched back (Julian, 2026-10-08).
- **Q-B2. What does the switch look like?**
  - (a) *Recommended:* a two-part toggle, "Plan A | Plan B", under the
    day heading. It always shows which plan you're on.
  - (b) One button, "Show plan B" / "Show plan A".
  - **Answer:** (a): a two-part "Plan A | Plan B" toggle under the day heading (Julian, 2026-10-08).
- **Q-B3. What's it called?** "Plan B" everywhere (the switch, the form
  checkbox, the entry page label), or "Backup plan"?
  - **Answer:** "Plan B" everywhere (Julian, 2026-10-08).
- **Q-B4. Hint on the trip timeline?** Should a day row on the trip's
  timeline show a small "Plan B" tag, so you know which days have one?
  Your answer 3 says day page only, so the plan is (a) no tag for now.
  (b) would add the tag, but nothing else.
  - **Answer:** (a): no tag for now (Julian, 2026-10-08).

### Answered (2026-10-08, Julian)

- Switching is only on this phone, and always there when the day has a
  plan B.
- Only editors (and the owner) see plan B and can switch.
- Only the day page's timeline. Not on the map, Today, weather, etc.
- Plan B items are added with the same form.
- Memories: not linked to activities, so nothing to do.
