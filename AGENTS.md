# AGENTS.md — Working Agreement for Coding Agents

This repository is a **launchpad template**: a working full-stack "hello world"
app (login + one example feature) that you extend into a real product from a
feature spec. Read this file first, every session.

## The three source-of-truth documents

| Doc | Use it for |
|---|---|
| [quickstart_technical.md](quickstart_technical.md) | The stack, architecture, and conventions. Reference, not a build script — the app is already built. |
| [design_doc.md](design_doc.md) | Visual + interaction direction (dark mode, 4px radius, semantic tokens, toast/loading/empty-state patterns). |
| `functional_spec.md` | The product to build. **You create this from the template** if it doesn't exist yet. |

If `functional_spec.md` is missing, the project hasn't been specified yet — help
the user fill in [templates/functional_spec.template.md](templates/functional_spec.template.md).

## The workflow — do not skip steps

1. **Verify the baseline first.** Start `make setup` (it creates `api/.env` with
   a generated `JWT_SECRET` on first run), then draft the plan while it installs.
   Verification must be complete before *phase work* begins, not before planning
   starts: confirm `make seed` and `make verify` are green before Phase 1. The
   hello-world app already exists — your job is to confirm it runs, not to
   recreate it.
2. **Write the implementation plan.** From `functional_spec.md`, produce
   `implementation_plan.md` using
   [templates/implementation_plan.template.md](templates/implementation_plan.template.md).
   Progress through **crawl → walk → run** stages, where each stage may contain
   **one or more phases** (e.g. several crawl phases for different parts of the
   app). Every phase is independently verifiable with its own test section. End
   with an **Open Questions** section.
3. **Stop for answers.** Do not start phase work until the user has answered the
   open questions inline in `implementation_plan.md`. Once answered, update the
   plan **body** — the Architecture, phase scopes and test bullets — not just the
   answer lines, so no phase still describes the pre-answer design.
4. **Execute one phase at a time.** After each phase: run `make verify`, update
   `PROGRESS.md`, commit, and **wait for the user to confirm** before starting
   the next phase.
5. **Raise deviations immediately.** If reality diverges from the plan (a design
   decision is missing, an approach won't work, a dependency conflicts), stop
   and surface it to the user rather than guessing.

## Hard rules

- **Anything that should be identical every project is a script, not improvised
  work.** Use the `make` targets and the seed script; don't hand-roll setup.
- **Never advance a phase without a green `make verify` and user confirmation.**
- **Never weaken security to make something pass** (no `--no-verify`, no
  disabling auth checks, no `allow_origins=["*"]` with credentials).
- **Keep the baked-in conventions** (see below). They're painful to retrofit.
- **Update `PROGRESS.md` as you go** so a dropped session can be resumed.

## Baked-in conventions (keep these)

- **Async everywhere** on the backend (SQLAlchemy async engine/session).
- **Every domain row is owned** via `user_id`; enforce ownership in one place
  (`get_owned_resource` pattern) and return **404** for missing/foreign rows.
- **Soft delete**, not hard delete (`SoftDeleteMixin` + `active()` filter).
- **UUID primary keys**, never sequential ints.
- **camelCase at the wire boundary** (snake_case Python, camelCase aliases) —
  *except* the fastapi-users user schemas (`UserRead`/`UserCreate`/`UserUpdate`),
  which fastapi-users owns and keeps snake_case (`is_active`, `is_superuser`).
  camelCase applies to domain endpoints.
- **User rows carry an IANA timezone** (`UserRecord.timezone`, default `UTC`);
  anything date-shaped resolves against it, not the server clock. Separate
  **instants** (store UTC-aware via `UtcDateTime`) from **wall-clock** values
  (a `time` with no offset; see `WallClockTime`) — conflating them is the source
  of most timezone bugs.
- **Admin routes live under `/admin`** with `current_superuser` declared once on
  the router, so new admin endpoints are protected by default and the admin
  surface stays greppable.
- **Thin routers, logic in `services/`.**
- **Frontend:** one Redux slice per feature; shared `apiClient` with the
  request/response interceptors; shadcn components in `ui/src/shared/components/ui`.
- **Follow `design_doc.md`** for all styling and interaction decisions.

## The example vertical slice

The `things` feature (backend `models.py`/`routers/things.py`/`services/things.py`,
frontend `features/things/`) is a complete reference slice: model → router →
service → slice → page → tests. **Extend this pattern for real features.** You
can rename or remove `things` once real features exist.

The `admin` feature (backend `routers/admin.py`/`services/users.py`, frontend
`features/admin/` + `shared/components/AdminRoute.jsx`) is the reference for the
privileged path: an `/admin/users` listing behind `current_superuser`, an
`AdminRoute` guard, and a nav button that renders only for superusers.

## Commands

```
make setup     # install deps + create api/.env (backend venv + npm)
make seed      # create seed users + sample data (idempotent, replants)
make reset-db  # drop the dev SQLite db and re-seed (after a schema change)
make dev       # dev-api + dev-ui together in one terminal (Ctrl-C stops both)
make dev-api   # API on :8000  (port from api/.env — differs per worktree)
make dev-ui    # UI  on :3000  (port from ui/.env  — differs per worktree)
make image     # build the unified single-container image (UI + API + nginx)
make verify    # lint + test everything — the gate before advancing a phase

make worktree NAME=<name>     # parallel worktree: own branch, ports, database
make worktree-list            # what's checked out where
make worktree-rm NAME=<name>  # remove a worktree and its branch
```

## Parallel worktrees — never assume ports 8000/3000

`make worktree NAME=<name>` creates a second checkout in
`<repo>/../<repo-name>-worktrees/<name>/` with its own branch off `main`, its own
port pair (API `8000+N`, UI `3000+N`), its own `.env` files and its own
`api/data/app-<name>.db`. It exists so a spike or a second feature can run
side by side with the main checkout instead of trampling it.

**If you are working inside a worktree, the ports are not 8000 and 3000.** Read
them before quoting a URL or curling an endpoint:

```
sed -n 's/^API_PORT=//p' api/.env       # API port
sed -n 's/^VITE_UI_PORT=//p' ui/.env    # UI port
```

`make dev-api` and `make dev-ui` already read these, so the commands don't
change. `CORS_ORIGINS` in `api/.env` is already pointed at this worktree's UI
port — if you hit a CORS error, the ports drifted; fix the `.env`, never
`allow_origins=["*"]`.

**`make verify` never renders a page in a browser.** jsdom component tests
confirm behaviour, not that anything is *visible* — a broken layout, an
off-screen element at 375px, or a dark-on-dark contrast failure all pass. A
full-browser e2e runner (Playwright) is deliberately **not** in the baseline
(the same way Alembic is deferred until the schema stabilises); until one is
added, **"a human looks at the UI at phone width"** is a required part of the
phase gate, not an optional one.

Seed users (dev credentials from `api/.env`): a general **user** and a **admin**
(`is_superuser`). Use them to exercise both normal and privileged paths.
