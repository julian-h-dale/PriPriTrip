# Run stage 11 — admin: invite people, reset passwords

Asked 2026-10-05 (Julian):
- **Invite a new user.** Admins only. The default password is
  `changeme-<username>`. The option is in the ☰ drawer on the trips screen.
- **Password reset.** An admin can reset someone's password back to
  `changeme-<username>`.
- **Force a password change** while the user still has the default: on
  first login, and after a reset.

Also answered then: the dev password for `pripri@example.com` is
`changeme-viewer` (the built-in `SEED_VIEWER_PASSWORD` default).

**Decisions (answered 2026-10-05):** every recommendation: a random one-time
password (not `changeme-<username>`), a flag the server enforces, public
sign-up closed, invite by email and name, resets on the Admin page, and
Change password in the drawer.

### Where we are

- **Accounts are fastapi-users.** `POST /auth/login` returns a 60-day JWT,
  and `POST /auth/refresh` slides it.
- **`POST /auth/register` is open to anyone.** The app has no sign-up
  screen, but the endpoint is live on `pripri-trip.fly.dev`, so anyone can
  make an account. They can't see a trip without a code, but it's still a
  door nobody uses.
- **fastapi-users' `/users` router is mounted.** `PATCH /users/me` lets a
  user change their own password, and `PATCH /users/{id}` lets a superuser
  change anyone's, including setting a password. Neither has a UI.
- **JWTs aren't revoked by a password change.** A token issued before a
  reset keeps working until it expires.
- **The admin surface:** `/admin` (`current_superuser` on the router) with
  `GET /admin/users`, the Admin page (a user list) and an Admin item in the
  drawer for superusers.
- **The seed passwords already fit the pattern:** `changeme-user` for
  user@, `changeme-admin` for admin@, and the e2e suite signs in with them.

### Design (assuming the recommended answers)

**Data.** `users.must_change_password` (bool, default false; migration
0009). Invite and reset set it; changing your password clears it. A flag,
not "is the password still the default?", so the seed accounts that dev and
e2e sign in with aren't caught (Q-A2).

**API** (thin routers; logic in `services/users.py`):
- `POST /admin/users` with `{ email, name }` creates an active, verified,
  non-superuser account, with the temporary password (Q-A1) and the flag
  set. It returns the user and the temporary password, once. The temporary
  password is random and readable: three groups of four lowercase letters
  and digits, with look-alikes left out (`k7mq-x2pd-9rhw`). An email
  already in use gives 409.
- `POST /admin/users/{id}/reset-password` sets the temporary password and
  the flag, and returns the password once. You can't reset yourself (409;
  use Change password). A missing user gives 404.
- `POST /auth/change-password` takes `{ currentPassword, newPassword }`
  (signed in). It checks the current password, applies fastapi-users'
  password rules plus "at least 8 characters and not the default", and
  clears the flag. It returns a fresh token.
- **The forced change is enforced on the server** (Q-A2). While the flag is
  set, every route except `/auth/*`, `GET /users/me` and change-password
  answers **403 `PASSWORD_CHANGE_REQUIRED`**. It's one dependency
  (`require_password_ok`), added where the routers are mounted, so a new
  router can't forget it. That also locks out a session from before the
  reset: the token still signs in, but can do nothing until the password is
  changed.
- `UserRead` gains `must_change_password`, so the app knows after login.
- **Public sign-up closes** (Q-A3): the register router is unmounted. The
  README's "sign up a backup account" becomes "invite it, then make it an
  admin".

**UI:**
- **Drawer, on the trips screen, admins only:** "Invite someone" opens a
  dialog with email and name. On save it shows the temporary password with
  a copy button ("Send them this; they'll choose their own when they sign
  in"), and a toast.
- **Admin page:** each user row gets "Reset password" (two-tap confirm), then
  shows the new temporary password with copy. A "Must change password" badge
  marks anyone who hasn't yet.
- **The forced change:** after login (or on any 403
  `PASSWORD_CHANGE_REQUIRED`), the app shows a full-screen "Choose a new
  password" form (current, new, confirm) and nothing else, except Sign out.
- **"Change password"** in the drawer for everyone (the same form, closable).

### Phases

- **Phase 54 — invites, resets and the forced change (API).** ✅ (2026-10-05)
  - **Scope:** migration 0009; the two admin endpoints; change-password;
    `require_password_ok` on every feature router; register unmounted;
    `UserRead.must_change_password`; README (backup account via invite).
  - **Tests:**
    - invite makes an account that can sign in with the temporary password,
      flagged; an email in use gives 409; non-admins get 403 and anonymous
      401;
    - reset sets the password and the flag, can't target yourself, and gives
      404 for a missing user;
    - while flagged, a trip read gives 403 `PASSWORD_CHANGE_REQUIRED` but
      `/users/me` and change-password work;
    - a wrong current password, a short password or the default itself is
      refused; a good change clears the flag and everything works;
    - an old token after a reset is locked until the password changes;
    - `POST /auth/register` is gone (404/405);
    - the migration leaves existing users unflagged.
- **Phase 55 — invites, resets and the forced change (UI).** ✅ (2026-10-05)
  - **Scope:** the Invite dialog in the drawer (trips screen, admins), the
    Admin page's Reset password and badge, the forced change screen, and
    Change password in the drawer.
  - **Tests:**
    - Invite shows only for admins and only on the trips screen, and shows
      the password once with copy;
    - Reset needs a second tap and shows the new password;
    - a flagged user lands on the forced form and can only sign out or
      change it; afterwards the app opens normally;
    - Change password validates (match, length) and shows a toast.
  - **E2E:** the admin invites a throwaway user, who signs in and is made to
    change the password. The admin resets it, and it's forced again.
    Screenshots at 375 px.

### Built (2026-10-05): Phases 54–55

Built as planned, one commit each, with `make verify` green (227 API + 341
UI tests). The e2e suite (23 specs) passes, including the new
`accounts.spec.js`: invite, forced change, reset, forced again. It reuses one
throwaway account, `e2e-invitee@example.com`, since accounts can't be
deleted. Screenshots `40`–`42`.

**Details:**
- The gate (`require_password_ok`, in `app/users.py`) is mounted on every
  feature router in `main.py`. The photo router guards only its upload and
  delete routes, because serving photos is login-free. Still reachable with a
  temporary password: `/auth/*` (login, refresh, change-password) and
  fastapi-users' `/users/me`.
- The new password must be at least 8 characters, differ from the current
  one, and not start with "changeme".
- The UI handles 403 `PASSWORD_CHANGE_REQUIRED` in the API client: it turns
  on the forced screen instead of showing an error toast. `ProtectedRoute`
  and `AdminRoute` both show the forced screen.
- `CopyField` (the copy box) is shared by the Share dialog, the invite and
  the reset.
- On the Admin page, the Password column sits next to Email, so Reset stays
  beside the right person at 375 px (the table scrolls sideways).
- Fixed along the way: a Currency test cleared the page by hand; it now uses
  `cleanup()`.

**Before relying on it (Julian):**
- Deploy. Fly runs migration 0009 on start, and existing accounts aren't
  affected.
- Public sign-up is gone, so new accounts come from Invite someone. That
  includes the Pi's backup account (README updated).
- If `pripri@example.com` exists on Fly with the seed password, reset it
  from the Admin page, or leave it, since it's only on the sample trip.

### Open questions (Run stage 11)

- **Q-A1. The temporary password.**
  - (a) `changeme-<username>`, as asked. "Username" means the part of the
    email before the @, so `pripri@example.com` would get
    `changeme-pripri`.
  - (b) A random one-time password (e.g. `maple-orbit-42`) that the admin
    sees once, with copy, and sends.
  - The catch with (a): the site is public, so anyone who knows (or guesses)
    the email can sign in before the real person does, change the password
    and keep the account. The forced change doesn't help, because the
    intruder makes the change. The same goes for the window after every
    reset.
  - Recommendation: **(b)**. It's the same flow for you (copy, text it),
    just not guessable.
  - **Answer:** as recommended (2026-10-05).
- **Q-A2. How is "still has the default" detected and enforced?**
  - (a) A flag set by invite and reset, cleared by a change, and enforced
    by the server (every route but auth answers 403 until changed).
  - (b) Compare the password with the default at each login. That would also
    catch the dev seed accounts (`changeme-user` and `changeme-admin` fit
    the pattern) and force them to change, breaking the e2e suite's
    sign-ins.
  - (c) The flag, but enforced only by the app's screens.
  - Recommendation: **(a)**. The server enforcing it also locks out an old
    session after a reset.
  - **Answer:** as recommended (2026-10-05).
- **Q-A3. Close public sign-up?** `POST /auth/register` lets anyone make an
  account today (no screen, but the endpoint is live).
  - Recommendation: **yes**, now that admins invite people.
  - **Answer:** as recommended (2026-10-05).
- **Q-A4. What does an invite take?**
  - (a) Email and name.
  - (b) Also a trip and a role, joining them to it straight away (handy for
    the in-laws).
  - (c) Also "make admin".
  - Recommendation: **(a)** for now. They join with a code as today, and
    "admin" stays a deliberate `make_admin`.
  - **Answer:** as recommended (2026-10-05).
- **Q-A5. Where do resets live?** Recommendation: on the **Admin page**,
  per user (the drawer item stays "Invite someone", as asked). Plus
  **"Change password" in the drawer for everyone**, since the forced change
  needs that form anyway.
  - **Answer:** as recommended (2026-10-05).
