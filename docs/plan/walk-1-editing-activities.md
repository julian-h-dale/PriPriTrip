# Walk stage — editing day activities

Scope: create, update and delete **activities** (`days[].items[]`). Stays and
travels stay read-only. Their markers get no edit controls.

### Design (assuming the recommended answers below)

- **One write path:** every edit goes through new functions in
  `services/trips.py`.
- **Shared validation:** an edited activity is validated by the same code as an
  import.
  - The body is an `ItemDoc`, so structure and unknown-field rules are
    identical.
  - The per-activity rule (start on the day's date, end after start) is
    factored out of `check_rules` into `check_item`, which both import and edit
    call.
- **Full replace, not patch:** the form always sends the whole activity, so
  there's no absent-vs-null ambiguity (lessons §8).
- **Writes return the updated trip** (`TripRead`). The UI swaps it into state
  in one round trip, so nothing goes stale and `buildTimeline` just re-runs.
- **Endpoints**, all behind `get_owned_trip`. An activity on another trip, or a
  deleted one, returns 404.
  - `POST   /trips/{id}/items` takes an `ItemDoc` plus `date` and creates the
    activity at the end of that date. It creates the day row if the date has
    none. (The date is in the body rather than the URL, so create and replace
    take the same shape.)
  - `PUT    /trips/{id}/items/{item_id}` replaces an activity. If its `date`
    changes, it moves to the end of that day.
  - `DELETE /trips/{id}/items/{item_id}` soft-deletes it and returns the
    updated trip, like every other edit.
  - `PUT    /trips/{id}/days/{date}` sets the day's title and summary,
    creating the day row if needed (Q5).
  - `POST   /trips/{id}/items/{item_id}/move` with `{ "direction": "up" |
    "down" }` swaps the activity with its neighbour within the day.
- **UI:**
  - An "Add activity" button sits under each day's list.
  - An expanded activity shows Edit, Move up/down and Delete.
  - Edit and add use one hand-written `ActivityForm` in the Dialog, shaped as a
    bottom sheet on a phone. Fields:
    - Title
    - Day (select)
    - Start and end time
    - Location: name, address, link
    - Confirmation number
    - Notes (markdown textarea)
  - The form validates on submit. Server 422 paths are mapped onto the fields
    inline.
  - Delete asks for confirmation. Every write shows a toast.

### Phase 5 — Walk: activity edit API ✅

- `check_item` extracted; `create_item`, `replace_item`, `delete_item` and
  `move_item` added to `services/trips.py`; routes added.
- Tests:
  - Create on an existing day, and on a date with no day row.
  - Replace, including a move to another day.
  - 422 with paths.
  - Delete hides the activity from `GET`.
  - Move up/down, including at the ends of the list.
  - Foreign or deleted items return 404; anonymous requests return 401.
  - Import and edit reject the same bad activity the same way.

### Phase 6 — Walk: activity editing UI ✅

- `ActivityForm` (time inputs on the day's date; end before start rolls to
  the next day).
- Edit, add, move and delete wired into `TimelineEntry` and `DayPanel`, with
  `timelineSlice` thunks that replace the trip.
- Tests:
  - Add, then edit, then delete, with mocked API calls.
  - Inline field errors from a 422.
  - Markers have no edit controls.
  - Phone-width check. (Agent: a live add/edit run at 375px, with the save
    confirmed through the API. A human look is still the gate.)
- Also fixed: the Dialog re-ran its focus effect on every render, which pulled
  focus out of form fields mid-typing.

### Open questions (editing)

1. **Where do the edit controls live?**
   - (a) Inside an expanded activity, plus an "Add activity" button under each
     day.
   - (b) An "Edit day" mode that shows controls on every activity at once.
   - Recommendation: **(a)**. It reads cleanly and needs no mode.
   - **Answer:** recommended (2026-10-02).
2. **Reordering untimed activities: now or later?** Their position matters,
   because a marker merges in around them.
   - Options: Move up/down buttons now; drag-and-drop (needs a touch DnD
     library); or later.
   - Recommendation: **Move up/down now**.
   - **Answer:** recommended (2026-10-02).
3. **Move an activity to a different day?**
   - Recommendation: **yes**, via a Day select in the form. The activity lands
     at the end of the new day.
   - **Answer:** recommended (2026-10-02).
4. **Adding to a date with no day entry** (like May 10). A day row needs a
   title today.
   - (a) Make `DayDoc.title` optional. The tab and heading already fall back to
     the date. This is a small schema change, and the schema regenerates.
   - (b) Ask for a title when adding the first activity.
   - Recommendation: **(a)**.
   - **Answer:** recommended (2026-10-02).
5. **Edit the day's own title and summary now too?**
   - It's cheap with the same pattern (`PUT /trips/{id}/days/{date}`).
   - Recommendation: **yes**, as a small "Edit day" button in the panel
     header.
   - **Answer:** recommended (2026-10-02).
6. **Time entry.** The form takes times only, with the date coming from the
   day.
   - Recommendation: an end time earlier than the start rolls to the next day
     (22:00–01:00), shown as "+1".
   - **Answer:** recommended (2026-10-02).
7. **Timezone override and coordinates on an activity.**
   - Recommendation: **not in the form for now**. Existing values are
     preserved on save, and the map link uses the address when there are no
     coordinates. Places lookup is later.
   - **Answer:** recommended (2026-10-02).
8. **Write semantics.** Full replace (PUT) of the whole activity, or PATCH?
   - Recommendation: **PUT**.
   - **Answer:** recommended (2026-10-02).
