# Adopting template updates into an existing app

This template evolves. When it gains something you want in an app you already
built from it — the unified container, the Fly.io deploy, the admin page — you
don't have to start over or copy files by hand.

**Every app built from this template shares its git history.** That's the whole
trick: you add the template as a git remote and pull the generic pieces straight
across with `git checkout`, then wire the app-specific bits in by hand.
[scripts/adopt-template-updates.sh](scripts/adopt-template-updates.sh) automates
the mechanical half; this doc covers the rest.

## What moves, and how

The gap between an old fork and the current template falls into three buckets:

| Bucket | Examples | How it moves |
|---|---|---|
| **Generic, drop-in** | `Dockerfile`, `.dockerignore`, `fly.toml`, `deploy/`, `.github/workflows/ci.yml`, the three admin UI files, the worktree scripts + skill | Copied verbatim by the script |
| **App-specific wiring** | `store.js`, `App.jsx`, the home-page nav, `Makefile` targets, an admin test, the dev-port plumbing | Manual — snippets below |
| **Already present / skip** | the example `things` slice; timezone types you already have | Don't copy |

> **Timezone types:** the template keeps `UtcDateTime` / `WallClockTime` in
> `api/app/db_types.py`. Some forks already have the same code inline in
> `models.py` / `schemas.py` — that's identical behaviour, just a different file.
> **Don't migrate it**; extracting working code only risks breakage. Only adopt
> `db_types.py` if your app has no timezone handling at all, and remember it
> means editing your models plus a `make reset-db` (no Alembic yet).

## Run the script

From the **root of the target app** (a clean working tree):

```bash
cd /path/to/your-app
bash /path/to/project-template/scripts/adopt-template-updates.sh
```

It adds a `template` remote (SSH by default), fetches it, creates a
`chore/adopt-template-updates` branch, and copies the drop-in files. To pull
from a local checkout instead of GitHub:

```bash
TEMPLATE_REMOTE=/path/to/project-template bash .../adopt-template-updates.sh
```

## Manual wiring

### 1. `ui/src/app/store.js`

```js
import adminReducer from "@/features/admin/adminSlice";
// ...
reducer: {
  // ...existing reducers...
  admin: adminReducer,
},
```

### 2. `ui/src/app/App.jsx`

```jsx
import { AdminUsersPage } from "@/features/admin/AdminUsersPage";
import { AdminRoute } from "@/shared/components/AdminRoute";
// ...inside <Routes>:
<Route
  path="/admin"
  element={
    <AdminRoute>
      <AdminUsersPage />
    </AdminRoute>
  }
/>
```

### 3. Home page — a superuser-only entry point

Render a control that only superusers see, matching your app's own header/nav
style, and have it navigate to `/admin`:

```jsx
const user = useSelector((s) => s.auth.user);
// ...
{user?.is_superuser && (
  <Button ... onClick={() => navigate("/admin")}>Admin</Button>
)}
```

The server's `current_superuser` (403) is the real boundary; this control and
`AdminRoute` just mirror it in the UI.

### 4. `Makefile` — container targets

```make
# add to .PHONY: ... image run-container

# Unified single-container image (UI + API behind one nginx). See deploy/README.md.
image:
	docker build -t app:latest .

run-container:
	docker run --rm -p 8080:8080 \
	  -e JWT_SECRET=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))') \
	  -e DATABASE_URL=sqlite+aiosqlite:////data/app.db \
	  app:latest
```

Also add the `help` lines for them if your Makefile has a `help` target.

### 5. `fly.toml`

Set `app = "<your-fly-app>"` and `primary_region`. Leave the `/data` volume
mount and `DATABASE_URL = "sqlite+aiosqlite:////data/app.db"` as-is. Before the
first deploy: `fly secrets set JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')`.

### 6. Admin UI test

The template's `AdminUsersPage.test.jsx` is coupled to its example home page and
reducers, so it isn't copied. Add one adapted to your app: import your reducers
and your home page, assert the Admin control shows for a superuser and hides for
a normal user, and that `AdminRoute` redirects non-superusers.

### 7. Dev ports — make them env-driven

The worktree scripts hand each worktree its own port pair by writing `.env`
files. Without these four edits the scripts run fine and produce a worktree that
listens on nothing useful: every checkout still binds 8000/3000 and the second
one dies with "address already in use".

**`api/dev.sh`** — take the port from `.env` (one key, not a full `source`, since
`.env` also holds seed credentials):

```bash
API_PORT="${API_PORT:-$(sed -n 's/^API_PORT=//p' .env 2>/dev/null | tail -1)}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${API_PORT:-8000}" --reload
```

**`ui/vite.config.js`** — switch to the function form and read the port:

```js
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  return {
    // ...plugins, resolve, test unchanged...
    server: {
      port: Number(env.VITE_UI_PORT || 3000),
      strictPort: true,
    },
  };
});
```

`strictPort` is not optional. Without it Vite silently falls forward to the next
free port — which is another worktree's port — while `CORS_ORIGINS` still names
this one, and you get a CORS error that looks like a backend bug.

**`ui/src/shared/config/appConfig.js`** — let `ui/.env` win in dev. The dev
server also serves `public/runtime-config.js`, whose `window.__APP_CONFIG__`
otherwise outranks `VITE_API_BASE_URL` and pins every worktree's UI back to
`:8000`:

```js
const devApiBaseUrl = import.meta.env.DEV ? import.meta.env.VITE_API_BASE_URL : undefined;

export const appConfig = {
  apiBaseUrl:
    devApiBaseUrl || runtime?.apiBaseUrl || import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
};
```

Built bundles are unaffected — runtime config still wins there, so one image can
still be repointed without a rebuild.

**`api/.env.example`** gains `API_PORT=8000`; **`ui/.env.example`** gains
`VITE_UI_PORT=3000`.

### 8. `Makefile` — worktree targets

```make
# add to .PHONY: ... worktree worktree-list worktree-rm

worktree:
	@test -n "$(NAME)" || { echo "usage: make worktree NAME=<name>"; exit 1; }
	@bash scripts/new-worktree.sh "$(NAME)"

worktree-list:
	@git worktree list

worktree-rm:
	@test -n "$(NAME)" || { echo "usage: make worktree-rm NAME=<name>"; exit 1; }
	@bash scripts/rm-worktree.sh "$(NAME)"
```

Also parameterise the container's host port so two worktrees can each run one —
`HOST_PORT ?= 8080` and `-p $(HOST_PORT):8080` in `run-container`.

## Verify

```bash
make verify                    # lint + tests
make image && make run-container
# open http://localhost:8080 and log in as the seeded admin
```

The container's `deploy/start.sh` runs `python -m app.seed` on boot (idempotent),
so the admin user exists on a fresh container/volume. Confirm login works at
phone width before you call it done.

If you adopted the worktree tooling, check it end to end too — the failure mode
is a port that nothing listens on, which `make verify` will not catch:

```bash
make worktree NAME=adopt-check     # should report :8001 / :3001
cd ../<your-app>-worktrees/adopt-check
make dev-api & make dev-ui         # both must bind, and login must work
cd - && make worktree-rm NAME=adopt-check
```
