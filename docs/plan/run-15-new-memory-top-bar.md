# Run stage 15 — New memory in the top bar, Share in the drawer

Asked 2026-10-06 (Julian), on branch `details-page`. Recommendations taken:
- **Top bar:** New memory (a filled blue icon button, writers only) where
  Share was, before Search, on every trip page; it opens `MemoryDialog`.
  Saving stays on the page, with the usual toast.
- **Drawer, Trip tools:** Currency, Weather, Time zones, Packing, Documents,
  Share trip (owner only; `ShareTripDialog` over the drawer, like Invite).
- **Journal and Today:** their New memory buttons go. Today shows the
  temperature now (°F, with the weather icon) in that spot, linking to
  Weather; nothing when there's none (no key, or the trip is over).

### Built (2026-10-06): Phase 67

`make verify` green (246 API + 428 UI). E2E screenshots `05` (Today with
the temperature, stood in because the sample trip is over), `05a` (the
drawer), `05b` (Share from the drawer). The sharing specs pass up to the
viewer's sign-in (the known `pripri@` dev password).
