# Run stage 31 — Today keeps up; Share moves to settings; a secret link for family

Julian (2026-10-12):
1. Update the Today page so "Next up" keeps up with the clock, the way
   Today's plan now fades minute by minute (Run 30).
2. Remove Share trip from the drawer. Sharing is only on the Trip settings
   page.
3. A secret link for a trip: anyone with it can view the trip, with no
   account (parents and other family). It's turned on for a trip, which
   makes the link, and it can be rotated.
4. A document on overriding a device's time and time zone, to test the
   example trips as if you were there.

**Status: answered; building.** On branch `grey-out-past-entries` (Run
30, not merged yet), as Julian asked: no new branch.

## Where we are

- **Today's "Next up"** uses `now` frozen when the page opened
  (`useState(() => new Date())` in `TodayPage`). Its "in 25 min" and the
  choice of what's next don't move on. Today's plan (Run 30) has its own
  `useNow(60_000)`.
- **Share trip** is an owner-only button in the drawer's trip section that
  opens `ShareTripDialog`. Since Run 29 it's just a wrapper round
  `MembersPanel`, which the Trip settings page's People section already
  shows.
- **Access to a trip is always a signed-in account.** `get_viewable_trip`
  lets in the owner and members (`trip_members`, viewer or editor).
  Everything a viewer may not do or see is enforced on the server by role:
  403 on writes, no plan B, no confirmation numbers, only public memories,
  and so on (Runs 17, 25, 10). The app's offline copies, outbox and
  analytics are keyed by the signed-in user's id (from the JWT).
- **Leftovers:** `trips.view_code` (unique, nullable) has been unused since
  Run 26 removed join codes. Photos are already served by unguessable URL
  with no login.
- **Sign-in:** a 60-day JWT, refreshed at most once a day
  (`/auth/refresh`). Every request checks the user `is_active`, so turning
  an account off ends its sessions on their next request.

## Design

### 1. Today keeps up (small)

`TodayPage` uses one clock, `useNow(60_000)`, for everything: which day
Today is about, Next up and its "in 25 min", Tonight, and the plan's
fading. If the page stays open past midnight, it moves on to the new day.

### 2. Share trip leaves the drawer

The drawer loses Share trip. `ShareTripDialog` is deleted;
`MembersPanel` lives on in Trip settings → People. The drawer tests that
opened sharing through it now go through the settings page.

### 3. The secret link

**How it works: a guest account behind the link (Q1).** Turning the link
on makes a hidden **guest** user for the trip, a viewer member of it. Opening the link
signs the browser in as that guest. From then on the app is exactly a
viewer's app: every rule viewers already have is enforced by the server's
existing role checks, and nothing new has to be taught about "link
visitors". Offline copies, the journal's public memories and photos all
work as they do for a viewer.

- **The link:** `https://<the app>/s/<secret>`. The secret is 32 random
  bytes, URL-safe (about 43 characters). It's stored in `trips.view_code`,
  the unused column with a unique index already in place.
- **Opening it:** the UI route `/s/:secret` calls
  `POST /links/{secret}/session` (no login), which returns a token for that
  trip's guest, the same shape as `/auth/login`. The app stores it and opens
  the trip's timeline. An unknown or turned-off link gets one plain page:
  "This link doesn't work any more. Ask whoever sent it for a new one."
  The answer is a 404 either way, so nothing tells you whether a trip
  exists.
- **Already signed in** on that browser (you testing your own link):
  see Q2.
- **Rotate:** a new secret, and the old guest account is turned off and a
  new one made, so anyone using the old link is signed out on their next
  request (even if they kept the app open), and the old link stops
  working. Confirmation first: "The current link stops working, and anyone
  using it will need the new one."
- **Turn off:** clears the secret and turns the guest off. Turning it on
  again makes a new link (never the old one).
- **Who controls it:** the owner, on Trip settings → People, under the
  member list: a "Link sharing" switch, then the link with Copy, plus
  Rotate. Editors don't see it, the same as the member list (owner only on
  the server too).

**Guests: what's different from a viewer with an account**

- The guest is **hidden**: not in Admin → Users, not in the trip's member
  list (the link has its own row instead), and its email
  (`link-<id>@guest.example.com`) is never shown. Its password is a random
  value nobody knows, so it can't sign in with a password.
- **The guest's app:**
  - The trips list shows only that trip, and opening the app (`/`) goes
    straight to it.
  - The drawer has no Change password and no account details.
  - Sign out says "You'll need the link again to come back."
- **Writing:** nothing. A guest is a viewer: no journal entries, no packing
  (Q3).
- **Analytics:** guests' visits are counted as role "guest", so family
  following along can be told apart from people with accounts (Q4).
- **Security notes:** the link is a bearer secret. Anyone it's forwarded
  to gets in, which is the point, and Rotate is the remedy. It never grants
  more than viewer. The session endpoint answers only a trip's current
  secret. With 256 bits of randomness, guessing is not a practical attack,
  so there's no rate limit beyond what nginx already has. A rotated guest's
  phone keeps its saved offline copy until it's next online, as for a
  removed viewer today.

**Tables:** migration **0018**: `users.guest_trip_id` (nullable uuid; set
means "this is a link guest for that trip"; no FK, the same reason as
before). The secret goes in the existing `trips.view_code`. No other new
columns.

### 4. The time-travel testing doc

`docs/testing-dates-and-time-zones.md` (Q6), written for Julian, not a
plan phase:

- **Desktop Chrome** (quickest):
  - DevTools → ⋮ → More tools → **Sensors** → Location → set the
    **Timezone ID** (e.g. `Europe/Athens`). This changes the time zone
    only, not the date.
  - To also move the date and time: start Chrome with `faketime` (Linux:
    `faketime '2026-05-11 11:30:00' google-chrome --user-data-dir=/tmp/x`)
    or a `TZ=` variable, or use the Playwright `page.clock` pattern the
    e2e specs already use (`done-entries.spec.js`).
- **iPhone:** Settings → General → Date & Time → turn off Set
  Automatically → pick the time zone and date. The steps to undo it.
- **Android:** Settings → System → Date & time → the same.
- **Gotchas this app has, with what you'd see:**
  - Moving a phone's date outside the HTTPS certificate's validity
    (Let's Encrypt certificates last 90 days) makes every request fail, so
    the app behaves as offline and shows saved copies.
  - Moving it more than 60 days ahead makes the app think its sign-in has
    expired, so it stops refreshing it.
  - "This phone" on the Time zones page follows the phone's zone; the
    trip's times never do.
  - Put the time back before using the app for real (photos and memories
    get the phone's time as their own).
- **What to test where:** Today (active vs preview), Run 30's fading,
  check-out day on Tonight, countdowns, Athens vs Chicago.
- **The Pi over VNC (Q5):** change the Pi's clock, so the browser on it
  and the dev API (the server's "now") move together. How to do it with
  `timedatectl`, and how to put it back (`set-ntp true`). A per-process
  alternative, `faketime`, changes only the dev API and that one Chromium,
  not the whole Pi (anything else running there keeps the real time). What
  the server's own clock affects: when a memory was received, the weather
  cache, sign-in tokens issued while the clock is moved.

## Phases

### Phase 105 — Today keeps up; Share leaves the drawer

Frontend only.

- `TodayPage`: one `useNow(60_000)`. `referenceDay`, `nextUp`, `tonight`
  and the fading all take it.
- `NavDrawer`: no Share trip. `ShareTripDialog` deleted. Its tests are moved
  to `MembersPanel` / Trip settings.

**Tests**

- Today: as the minute ticks past an entry's time, Next up moves to the
  next thing and the entry fades. "in 25 min" counts down. Past midnight,
  the page is about the new day.
- The drawer has no Share trip for an owner. The People section has
  everything the Share dialog had (invite, roles, remove).
- `make verify` green; a human looks at Today on a phone.

### Phase 106 — the secret link (API)

- Migration 0018 (`users.guest_trip_id`).
- `services/share_links.py`: `enable`, `rotate`, `disable`, `session`. Each
  makes or turns off the guest user and its viewer membership.
- Routes (owner, via `get_owned_trip`):
  - `GET /trips/{id}/link` gives `{ enabled, url }`;
  - `POST /trips/{id}/link` turns it on or rotates (the body says which);
  - `DELETE /trips/{id}/link` turns it off;
  - and, with no login, `POST /links/{secret}/session` gives
    `{ access_token, token_type }`.
- Guests are left out of `list_users` (admin) and the trip's members list.
  `/users/me` says `isGuest` and the trip's id.

**Tests**

- On: a link; its session token reads the trip as a viewer; every write is
  403; no plan B or confirmation numbers; only public memories.
- The guest's trips list has just that trip, and the guest can't reach
  another trip (404).
- Rotate: the old secret is 404, and the old guest's existing token is 401
  on its next request. The new link works.
- Off: the secret is 404 and the token is 401. On again gives a different
  link.
- Only the owner: an editor gets 403, a viewer 403, a stranger 404.
- Guests aren't in Admin → Users or the members list. A guest can't change
  a password or sign in with one.
- `make verify` green.

### Phase 107 — the secret link (app)

- `/s/:secret` route: sign in as the guest, then the trip. The "link
  doesn't work" page. Already signed in: Q2.
- Trip settings → People: Link sharing switch, the link with Copy, Rotate
  (confirm), and turning it off (confirm).
- The guest's app: only their trip, no Change password, the sign-out
  wording, role "guest" in analytics.

**Tests**

- Opening a link stores the guest token and lands on the timeline. A dead
  link shows the page that says so.
- Owner: switch on, copy, rotate (the URL changes after confirming), switch
  off. Not shown to editors.
- Guest drawer: no Change password, and the sign-out wording.
- E2E at 375 px, dark and light: turn the link on as the owner, open it
  in a fresh browser (no account), see the trip as a viewer; rotate, and
  the old link shows the dead-link page. A human sends a link to a phone.

## Built

### Phase 105 (2026-10-12): Today keeps up; Share leaves the drawer

`make verify` green (328 API + 717 UI).
- `TodayView`: `useNow(60_000)` → `now` (a `Date`) for `referenceDay`,
  `nextUp`, `untilLabel` and the fading. Tests move a faked clock with the
  trip preloaded: Next up's countdown runs, it moves past lunch at 12:16,
  and at 00:01 the page is about the next day.
- The drawer's Share trip, `ShareTripDialog`, and the drawer's
  `share-open` analytics event are gone. The owner tests run against
  `MembersPanel`; the e2e sharing tests use Trip settings → People.
- **Already failing, not this change:** e2e `trip.spec.js` "the owner
  shares, the viewer reads…" times out in the viewer's half. It fails the
  same with this phase stashed. The owner's half (People lists the viewer)
  passes.

### Phase 106 (2026-10-12): the secret link, on the server

`make verify` green (337 API + 717 UI).
- Migration 0018: `users.guest_trip_id`. The secret is in `trips.view_code`.
- `services/share_links.py`: `enable` (idempotent), `rotate`, `disable`,
  `guest_for(secret)`, and `forget` (called by `delete_trip`). A guest is
  an active, verified non-admin with an unknown random password, named
  "Anyone with the link", plus a viewer `TripMember`. Retiring sets
  `is_active = False` and ends the membership.
- Routes, owner only (`get_owned_trip`): `GET /trips/{id}/link`,
  `POST /trips/{id}/link` (on), `POST /trips/{id}/link/rotate`,
  `DELETE /trips/{id}/link`; all answer `{ enabled, secret }`. The app
  builds the URL from its own origin, because the API doesn't know it.
  `POST /links/{secret}/session` (no sign-in, `links_router`) is
  `auth_backend.login` as the guest, or 404.
- Guests are left out of `list_users` (Admin), `list_members` and
  `user_by_email` (can't be invited). `/auth/change-password` and `PATCH
  /users/me` are 403 for a guest (`UserManager.update`). `UserRead` has
  `guest_trip_id`.
- **Small changes from the plan:**
  - rotate is its own route, not a body flag;
  - the API returns the secret, not the URL;
  - the guest email is `link-<hex>@guest.example.com`, because the
    account library refuses `.invalid`. example.com is reserved, so it's
    never a real mailbox.
- Tests (`test_share_links.py`, real tokens for the guest): a viewer's
  read (no confirmation numbers, no plan B, only public memories, just
  that trip, writes 403); rotate and off give 401 for the signed-in guest,
  including `/auth/refresh`, and 404 for the old secret; a deleted trip
  takes its link with it; owner-only; hidden from Admin, members and
  invites; no password or profile changes.

### Phase 107 (2026-10-12): the secret link, in the app

`make verify` green (338 API + 732 UI). E2E `share-link.spec.js` (dark and
light, with the API and UI for this branch on :8010/:3010): the owner turns
the link on; a fresh browser with no account opens it and lands on the
trip's viewer timeline, with the guest's drawer; Make a new link; the
guest's reload lands on `/link-ended`, and the old link says it doesn't
work (screenshots `31a`–`31c`).
- `/s/:secret` (`LinkPage`, outside `ProtectedRoute`):
  - `POST /links/{secret}/session`, then `tokenAdopted` and the trip's
    timeline. A 404 shows "This link doesn't work any more"; a network
    failure shows "Couldn't open the link" with Try again.
  - Someone signed in who's on the trip just goes there. Anyone else gets
    "Open as a guest? You'll be signed out of <email>."; Open as a guest
    signs out first.
- Trip settings → People → **Link sharing** (`LinkSharing`, owner): the
  switch, the link (`<origin>/s/<secret>`) with Copy, Make a new link
  (confirmed), and off (confirmed).
- The guest's app:
  - the drawer says "Viewing through a shared link" (never the hidden
    email), with no Change password, and Sign out notes "You'll need the
    link again to come back";
  - `/` goes straight to their trip, and their trip card has no ⋯;
  - analytics role "guest".
- **Additions the plan didn't spell out:**
  - The session answer also carries `trip_id`, so the app knows where to
    go without a second request.
  - A guest whose link is rotated mid-visit isn't sent to sign-in: a
    guest has no password. The 401 handler sends them to `/link-ended`
    instead (the same message). A localStorage flag (`auth_guest`, set by
    `tokenAdopted`, cleared by sign-in and `clearAuth`) says the sign-in
    came from a link; it's known before `/users/me` answers.
  - The link page itself is never redirected on a 401.
  - Found in the e2e run: the dead link showed a "Not found" error toast.
    The session request now `handles: [404]`.

## Open questions — answered (Julian, 2026-10-12)

1. **A guest account behind the link** → yes.
2. **Opening a link while signed in** → yes: already on the trip, just
   open it; otherwise ask before switching to the guest.
3. **Guests can't write anything** → yes.
4. **Analytics for guests** → yes, counted as role "guest".
5. **An in-app "Pretend it's…" clock** → no. Use the browser's DevTools,
   or the Pi over VNC, where the browser and the server's clocks both
   change. Phase 108 is dropped; the doc covers both.
6. **Where the doc lives** → in the repo: `docs/testing-dates-and-time-zones.md`,
   linked from `ui/e2e/README.md`.
7. **Branch** → Run 30's branch isn't merged; keep building on it.
