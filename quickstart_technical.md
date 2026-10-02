# Application Stack — Technical Reference

This document defines the technology stack and architectural conventions for building a full-stack web application using this codebase as its foundation. It is intentionally generic — free of any application-specific domain logic. The goal is to give an agent or developer a complete "hello world" baseline they can build on top of.

Deployment ships as a single unified container (UI + API behind one nginx) —
see the Containerization section and `deploy/README.md`.

---

## High-Level Architecture

```
ui/          React SPA (Vite)       ← user's browser
api/         FastAPI backend        ← Python, serves JSON REST API
```

The frontend communicates with the backend exclusively through JSON REST endpoints. The backend owns the database and all business logic. There is no server-side rendering.

---

## Stack at a Glance

### Backend

| Purpose | Library |
|---|---|
| API framework | **FastAPI** |
| ASGI server (dev) | **Uvicorn** |
| ASGI server (prod) | **Gunicorn** + `UvicornWorker` |
| ORM | **SQLAlchemy** 2.x async + `DeclarativeBase` |
| Query / session layer | **AsyncSession**, `async_sessionmaker`, `create_async_engine` |
| Schema migrations | **Alembic** |
| Input validation | **Pydantic** v2 |
| Settings / env | **pydantic-settings** |
| Auth library | **fastapi-users** + JWT bearer strategy |
| Password hashing | Built into **fastapi-users** via bcrypt |
| Database driver | **aiosqlite** (SQLite); any SQL-compliant DB works |
| Testing | **pytest** + FastAPI `TestClient` |

### Frontend

| Purpose | Library |
|---|---|
| UI framework | **React** 18 |
| Build tool | **Vite** 6 |
| Design / component library | **shadcn/ui** (Radix primitives, vendored) |
| Styling engine | **Tailwind CSS** |
| Routing | **React Router DOM** v6 |
| State management | **Redux Toolkit** + **React Redux** |
| HTTP client | **Axios** |
| Date handling | **Day.js** (format) + **react-day-picker** (shadcn Calendar) |
| Unit / component tests | **Vitest** + **@testing-library/react** |
| End-to-end tests | **Playwright** |
| Linting | **ESLint** |

---

## Backend

### Project Layout

```
api/
├── app/
│   ├── main.py          # FastAPI app, middleware, router registration
│   ├── settings.py      # Settings classes (pydantic-settings)
│   ├── database.py      # Async engine + session factory
│   ├── dependencies.py  # Auth dependencies and ownership checks
│   ├── users.py         # fastapi-users configuration and auth backend
│   ├── models.py        # SQLAlchemy declarative models
│   ├── routers/         # One file per feature; auth route separate
│   └── services/        # Non-trivial logic kept out of route handlers
├── migrations/          # Alembic migration scripts
├── tests/               # pytest test suite
├── requirements.txt
├── alembic.ini
└── dev.sh               # Start uvicorn with --reload for local dev
```

The production entrypoint lives at `deploy/start.sh` (part of the unified
container image) — it runs `alembic upgrade head`, then starts Gunicorn
alongside nginx. See the Containerization section.

Keep route handlers thin. Any logic beyond a simple DB read/write belongs in `services/`.

### Framework — FastAPI

FastAPI is the API framework. Every route file creates an `APIRouter` and is registered in `main.py`. The entry point is `app.main:app`, built by a `create_app()` factory.

```python
# main.py pattern
def create_app() -> FastAPI:
    application = FastAPI(title="App API")
    application.add_middleware(CORSMiddleware, ...)

    # fastapi-users auth + register routers first
    application.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth")
    application.include_router(fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth")

    # then each feature router
    application.include_router(things.router)
    return application

app = create_app()
```

Each feature router lives in its own file under `app/routers/` and is included explicitly in `create_app()`. The fastapi-users auth and register routers are mounted first, before the feature routers.

### ASGI Servers

- **Dev**: `uvicorn app.main:app --port 8000 --host 0.0.0.0 --reload`
- **Prod**: `gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --workers 2 --bind 0.0.0.0:80`

`deploy/start.sh` runs migrations then starts Gunicorn (behind nginx in the unified image). `dev.sh` runs Uvicorn directly with hot reload.

### ORM — SQLAlchemy async

This project uses SQLAlchemy 2.x with `DeclarativeBase` and explicit `Mapped[...]` annotations rather than SQLModel. That keeps the model layer closer to SQLAlchemy conventions, matches async patterns, and makes it easier to enforce DB-level invariants and performance tuning.

```python
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class MyModel(Base):
    __tablename__ = "my_table"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
```

This project keeps the model definitions in a single module (for example `app/models.py`) and imports the base metadata for migrations and table setup. Models should use `Mapped[...]` so nullability is explicit and the DB schema remains expressive.

The async DB engine and session factory live in `database.py`:

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

engine = create_async_engine(get_settings().database_url)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
```

Important: the default stack here is asynchronous. Do not assume a sync `Session`/`create_engine` pattern. This project moved to async SQLAlchemy so the whole API layer runs correctly under FastAPI's async request lifecycle. Even with SQLite this means using an async driver (`aiosqlite`) and the async engine/session APIs above.

### Database

- **Baseline default**: SQLite — `DATABASE_URL=sqlite+aiosqlite:///./data/app.db`. One less dependency to install and run; good enough to build and test the whole app locally.
- **Async driver**: SQLite still goes through the async engine via **aiosqlite**. The async session pattern is the constant, not the specific database.
- **Switching databases**: any SQL-compliant, SQLAlchemy-supported database works (PostgreSQL, MySQL, etc.). Swap the URL and the async driver (e.g. `postgresql+asyncpg://...`); the model and session code stays the same.
- **Production**: use whichever SQL database fits; the important part is keeping the async engine/session setup, not reverting to the sync ORM pattern.

### Schema Migrations — Alembic (deferred pattern)

**Alembic is in the stack but intentionally deferred during early development.**

Early on, use `Base.metadata.create_all` inside the FastAPI `lifespan` to create tables automatically on startup. This avoids migration overhead while the schema is still evolving.

**You will hit this:** `create_all` creates *missing* tables but never alters *existing* ones. Adding a column to a table that already exists produces `OperationalError: no such column` (which surfaces from `make seed`, reading like a broken seed script rather than a moved schema). While Alembic is deferred, a schema change means dropping the dev database and re-seeding — `make reset-db` does exactly that.

Once the schema stabilises, remove `create_all`, introduce Alembic, and generate a baseline migration:

```bash
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

`migrations/env.py` must import all models so `Base.metadata` is populated for autogenerate.

In production, `deploy/start.sh` runs `alembic upgrade head` on every container start so migrations apply automatically on deploy.

### Settings

Use `pydantic-settings` `BaseSettings` classes. Group related settings (e.g. auth settings separate from app-level feature settings). Cache each with `@lru_cache()`. Load from a `.env` file automatically.

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class AuthSettings(BaseSettings):
    jwt_secret: str           # no default — fails to boot if missing
    jwt_expiry_hours: int = 24
    allowed_origins: str = "http://localhost:3000"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache()
def get_auth_settings() -> AuthSettings:
    return AuthSettings()
```

Required settings (like `JWT_SECRET`) must have **no default** so the app fails fast rather than starting with an insecure value.

The `APP_ENV` env var can select a named env file (e.g. `APP_ENV=dev` → `.env.dev`).

### Authentication

Use the **fastapi-users** library for auth. This project standardised on the library rather than rolling a custom JWT implementation.

| Step | Mechanism |
|---|---|
| User table base | `SQLAlchemyBaseUserTableUUID` |
| Password hashing | built into **fastapi-users** via bcrypt |
| Token issuance | JWT bearer strategy (`JWTStrategy`) |
| Token transport | `Authorization: Bearer <token>` header |
| Router registration | `fastapi_users.get_auth_router(...)` and `fastapi_users.get_register_router(...)` |
| User DB adapter | `SQLAlchemyUserDatabase(session, UserRecord)` |

Typical setup from this project:

```python
from fastapi import Depends
from fastapi_users import BaseUserManager, FastAPIUsers
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

async def get_user_db(session: AsyncSession = Depends(get_db)):
    yield SQLAlchemyUserDatabase(session, UserRecord)

bearer_transport = BearerTransport(tokenUrl="/auth/login")

def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=_jwt_secret(), lifetime_seconds=60 * 60 * 24 * 7)

auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[UserRecord, UUID](get_user_manager, [auth_backend])
```

This gives you the standard routes automatically:

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/register`
- `GET /auth/me` or equivalent library endpoints as needed

`JWT_SECRET` must be set before the app starts. Generate a secure value with:
```bash
python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

### User Model (baseline)

The minimum user table is the fastapi-users base table plus any app-specific profile fields:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | provided by fastapi-users |
| `email` | str | unique, indexed |
| `hashed_password` | str | managed by fastapi-users |
| `is_active` | bool | standard lifecycle flag |
| `is_superuser` | bool | admin / privileged access |
| `is_verified` | bool | standard verification flag |
| `name` | str | application-specific display name |
| `timezone` | str | IANA name (e.g. `America/Chicago`), default `UTC` |

Extend with profile fields as needed. The baseline already ships `timezone`
(an IANA name, never a fixed UTC offset — an offset is wrong twice a year);
add further fields such as home location or profile details to the custom user
record as your product needs them.

### Multi-user assumptions (baseline)

This starter assumes a multi-user, multi-tenant-by-user app — not a single-user tool. These decisions are painful to retrofit, so bake them in from the first commit:

- **Every domain row is owned.** Top-level tables carry a `user_id` foreign key to the users table, indexed. A row that isn't tied to a user is the exception, not the rule.
- **Ownership is enforced in one place.** A shared dependency (e.g. `get_owned_resource`) loads the row *and* checks it belongs to the current user, returning **404** (not 403) for missing, foreign, or deleted rows so you don't leak whether a record exists.
- **Soft delete over hard delete.** A reusable mixin (`is_deleted`, `deleted_at`) plus an `active(Model)` filter helper. Deletes are reversible and hidden from normal queries rather than destroying data.
- **UUID primary keys, not sequential ints.** IDs are exposed to clients; sequential IDs are enumerable and leak how much data exists.
- **camelCase at the wire boundary.** snake_case Python fields with camelCase aliases, so the frontend contract stays stable regardless of Python style. (The fastapi-users user schemas are the one exception — fastapi-users owns them and keeps them snake_case.)
- **Time resolves against the user's clock.** User rows carry an IANA `timezone`; anything date-shaped resolves against it, not the server's clock. Separate **instants** (stored UTC-aware) from **wall-clock** values ("ends at 09:00", no offset) — they are two different types with two different rules.

### Route Structure

One `APIRouter` per feature, each in its own file under `app/routers/`, included explicitly in `create_app()`. Route handlers are thin and `async` — delegate business logic to `services/`.

```python
# app/routers/things.py
router = APIRouter(prefix="/things", tags=["things"])

@router.get("/")
async def list_things(
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
):
    ...
```

### CORS

`ALLOWED_ORIGINS` is a comma-separated env var. Apply it in `main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_headers=["*"],
    allow_credentials=True,
    allow_methods=["*"],
)
```

Do not use `"*"` as an origin when `allow_credentials=True` — browsers reject it and FastAPI will silently drop credentials.

### Validation

All request body validation uses **Pydantic v2** models. Route handlers declare typed body parameters; FastAPI validates them automatically. Keep DB models (SQLAlchemy `DeclarativeBase`) separate from request/response schemas (Pydantic `BaseModel`) so internal columns don't leak onto the wire.

### Coding Standards & Linting

The backend uses **Ruff** for both linting and formatting, and **mypy** for type checking.

- **Ruff lint** — configured in `pyproject.toml`. Rule set: `E,W,F` (pycodestyle/pyflakes), `I` (import order), `UP` (pyupgrade to modern Python idioms), `B` (bugbear — mutable defaults, loop-variable capture), `ASYNC` (flags blocking calls inside `async def`), `C4` (comprehensions), `RUF` (Ruff's own). Line-length is 100, target `py312`.
- **Ruff format** — owns formatting (double quotes). Because the formatter owns line length, `E501` is ignored.
- **mypy** — uses the `pydantic.mypy` plugin so Pydantic-generated `__init__`s type-check. Not strict, but `check_untyped_defs`, `no_implicit_optional`, `warn_redundant_casts`, and `warn_unused_ignores` are on — enough to catch a `str | None` flowing where a value is assumed.

```bash
cd api
ruff check .        # lint
ruff format .       # format
mypy                # type check (files = ["app"])
```

Keep the ruleset narrow and meaningful rather than turning on everything — a checker that reports hundreds of findings nobody fixes is worse than none.

### Testing

- Test suite: **pytest** in `api/tests/`
- HTTP client: FastAPI's `TestClient` (or `httpx.AsyncClient` for async paths)
- Database: in-memory SQLite via the async driver (`sqlite+aiosqlite://` with `StaticPool`) — no external DB required
- Auth bypass: override the fastapi-users current-user dependency, e.g. `app.dependency_overrides[current_active_user] = lambda: test_user`

```bash
cd api && pytest
```

### Minimum Environment Variables

```
JWT_SECRET=<generate with secrets.token_urlsafe(48)>
CORS_ORIGINS=http://localhost:3000
DATABASE_URL=sqlite+aiosqlite:///./data/app.db
```

---

## Frontend

### Project Layout

```
ui/
├── src/
│   ├── main.jsx             # App entry — Redux Provider, BrowserRouter, store injection
│   ├── index.css            # Tailwind directives (@tailwind base/components/utilities) + design tokens
│   ├── app/
│   │   ├── App.jsx          # Route definitions, auth bootstrap
│   │   └── store.js         # Redux store — assembles all slices
│   ├── features/            # One folder per domain feature
│   │   └── <feature>/
│   │       ├── components/  # Feature-specific React components
│   │       └── <feature>Slice.js   # Redux slice (state + async thunks)
│   └── shared/
│       ├── components/      # Reusable layout and UI components
│       │   └── ui/          # shadcn/ui components (vendored into the repo)
│       ├── services/        # Axios client(s), external API wrappers
│       ├── config/          # Runtime config reader
│       ├── hooks/           # Shared custom hooks
│       ├── utils/           # Shared utilities (incl. `cn()` class-merge helper)
│       ├── errorSlice.js    # Global error state
│       └── notificationSlice.js  # Global toast/notification state
├── public/
│   └── runtime-config.js   # Injected at container start for env-specific URLs
├── components.json          # shadcn/ui config (paths, style, base color)
├── tailwind.config.js       # Tailwind theme + content globs
├── postcss.config.js        # PostCSS: tailwindcss + autoprefixer
├── package.json
└── vite.config.js
```

### Build Tool — Vite

Vite 6 with `@vitejs/plugin-react`. Dev server runs on port `3000` by default.

```bash
cd ui
npm install
npm run dev        # dev server on :3000
npm run build      # production build → dist/
npm run preview    # preview the production build
npm run test       # vitest (watch)
npm run test:run   # vitest (single run, CI)
npm run lint       # eslint
```

This project also wires in `vite-plugin-pwa` for an installable, offline-capable app shell. It's optional for a new project — drop it if you don't need PWA behavior.

### Design / Components — Tailwind CSS + shadcn/ui

**Tailwind CSS** is the styling engine — utility classes in JSX, no CSS-in-JS. Define the design system (colors, spacing, fonts, dark mode) in `tailwind.config.js`, and expose design tokens as CSS variables in `src/index.css` (which also holds the `@tailwind base/components/utilities` directives).

**shadcn/ui** is the component layer. It is not a package you install and import — its CLI copies component source (built on **Radix UI** primitives, styled with Tailwind) directly into `src/shared/components/ui/`, so you own and can edit every component.

> **What the baseline actually ships.** To keep the dependency tree light, the
> components already in `src/shared/components/ui/` (`button`, `card`, `input`,
> `label`) are lightweight **hand-rolled equivalents in the shadcn *shape*** —
> not Radix-backed, and not vendored via the CLI (`button.jsx` is a `cva`
> wrapper over a plain `<button>`). New components should match that hand-rolled
> style for consistency. The `npx shadcn@latest add …` flow below is the
> alternative if you'd rather adopt real shadcn/Radix — note the CLI needs
> network access an agent may not have.

```bash
# Install Tailwind + the shadcn/ui runtime deps (versions resolved by npm — see package.json)
npm install -D tailwindcss postcss autoprefixer
npm install clsx tailwind-merge class-variance-authority lucide-react tailwindcss-animate

# Wire up shadcn/ui, then vendor components as needed (needs network access)
npx shadcn@latest init          # one-time: creates components.json, wires Tailwind
npx shadcn@latest add button    # vendor a component into shared/components/ui/
```

`react-day-picker` is pulled in automatically when you `npx shadcn@latest add calendar`.

Use shadcn/ui components as the baseline for all UI elements and compose/restyle them with Tailwind utilities rather than pulling in a separate component library. The `cn()` helper (`clsx` + `tailwind-merge`) in `shared/utils/` is the standard way to compose conditional classes.

Dark mode is class-based (`darkMode: "class"` in `tailwind.config.js`) — toggle it by adding or removing `dark` on the root element.

Date pickers use shadcn/ui's **Calendar** (built on **react-day-picker**) inside a **Popover**. Day.js stays as the parse/format library:

```jsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">
      {date ? dayjs(date).format("MMM D, YYYY") : "Pick a date"}
    </Button>
  </PopoverTrigger>
  <PopoverContent>
    <Calendar mode="single" selected={date} onSelect={setDate} />
  </PopoverContent>
</Popover>
```

### Routing — React Router DOM v6

All navigation uses React Router in `BrowserRouter` mode. Routes are declared in `App.jsx`. Wrap authenticated areas in a `ProtectedRoute` component that checks for a token and redirects to `/login` if absent. Wrap admin areas in an `AdminRoute` component (`shared/components/AdminRoute.jsx`) that additionally redirects non-superusers to `/`. Both are convenience gates — the real boundary is the server's `current_superuser` (403); the `AdminRoute` redirect and the superuser-only nav button just mirror it.

### State Management — Redux Toolkit

Redux Toolkit is the state management library. One slice per feature (`createSlice`, `createAsyncThunk`). Shared cross-cutting slices (`errorSlice`, `notificationSlice`) live in `shared/`. The store is assembled once in `app/store.js` and provided at the root in `main.jsx`.

```js
// store.js
const store = configureStore({
  reducer: {
    auth: authReducer,
    error: errorReducer,
    notification: notificationReducer,
    // ...feature reducers
  },
})
```

### HTTP Client — Axios

A single Axios instance in `shared/services/apiClient.js` is used for all backend calls. Configure it with:

- `baseURL` from runtime config / Vite env
- A **request interceptor** that attaches `Authorization: ****** from Redux store
- A **response interceptor** that:
  - Dispatches success toasts for write operations (POST/PATCH/PUT/DELETE)
  - On 401: clears auth state and redirects to `/login`
  - On other errors: dispatches an error toast via `errorSlice`

The store is injected into the client via an `injectStore(store)` call in `main.jsx` (avoids circular imports).

### Auth in the UI

Auth state lives in `features/auth/authSlice.js`. Store the JWT token in `localStorage` so it survives page refresh. On app load, if a token is present, call `GET /users/me` (the fastapi-users users router) to hydrate user info into the store. `ProtectedRoute` reads the token from the store to gate access.

### Runtime Config

`ui/public/runtime-config.js` is a plain JS file that sets `window.__APP_CONFIG__` and is loaded as a `<script>` tag in `index.html` — outside the Vite bundle. This lets environment-specific API base URLs be injected at container start time without rebuilding the app. `shared/config/appConfig.js` reads from this object, falling back to `import.meta.env` Vite env vars.

```js
// runtime-config.js (injected at deploy time)
window.__APP_CONFIG__ = { apiBaseUrl: "https://api.example.com" };
```

### SPA Routing Config

Serving a React SPA from a static host requires all paths to fall back to `index.html`. In the Nginx container this is handled in the Nginx config; in other static hosts a redirect rule file (e.g. `staticwebapp.config.json`) achieves the same.

### Testing

| Tool | Purpose |
|---|---|
| **Vitest** | Unit and component tests (runs in jsdom) |
| **@testing-library/react** | Render components and query the DOM |
| **ESLint** | Linting (eslint-plugin-react, eslint-plugin-react-hooks) |

Vitest is configured in `vite.config.js` under the `test` key (jsdom environment, a `setupFiles` entry for test globals). A browser end-to-end runner (e.g. Playwright) is **not** part of this baseline — it's deferred the same way Alembic is. jsdom confirms component *behaviour* but never that anything is actually *visible* (a broken layout, an off-screen element at 375px, or a dark-on-dark contrast failure all pass). Until a browser runner is added, **a human looking at the UI at phone width is a required part of the phase gate**, not an optional extra. Add Playwright when you want that check automated.

### Coding Standards & Linting

The frontend uses **ESLint** with the modern flat config (`eslint.config.js`):

- `@eslint/js` recommended rules as the base
- `eslint-plugin-react` + `eslint-plugin-react-hooks` (rules of hooks, exhaustive-deps)
- `eslint-plugin-react-refresh` for Fast Refresh safety
- `react/react-in-jsx-scope` is **off** (Vite's automatic JSX runtime needs no `React` import)
- `react/prop-types` is **off** (this codebase does not use PropTypes)
- `dist/` is ignored

```bash
cd ui
npm run lint       # eslint src
```

There is no Prettier in this baseline — ESLint is the single source of truth for JS/JSX style. Match the existing patterns (functional components, hooks, feature-folder structure) rather than introducing a competing style.

### Environment Variables

All frontend env vars are prefixed `VITE_` so Vite includes them in the bundle. The minimum set:

```
VITE_API_BASE_URL=http://localhost:8000
```

Sensitive keys (third-party API tokens) should not live in the frontend env — serve them from `GET /users/me` after login.

---

## Containerization

The app ships as a **single** unified image: the React UI compiled to static
assets and served by nginx, which reverse-proxies `/api/*` to a FastAPI process
on the loopback interface. One public port (`8080`), one deployable unit —
built for low-cost single-machine deployment (e.g. a single Fly.io Machine).

```
browser ──▶ nginx :8080 ──┬─▶ /            static UI (/var/www/html)
                          └─▶ /api/*  ──▶  gunicorn/uvicorn 127.0.0.1:8000
                                            (nginx rewrite-and-strips /api)
```

- **Root `Dockerfile`** — multi-stage: a Node stage compiles the UI and is
  discarded; the final Python image carries the runtime, the compiled assets,
  and nginx.
- **`deploy/nginx.conf`** — single ingress on `:8080`; `location /api/`
  rewrite-and-strips the prefix (`/api/things/` → `/things/`) and proxies to the
  backend. The API's own routes stay unprefixed.
- **`deploy/start.sh`** — entrypoint: `mkdir -p /data`, seed the database
  (idempotent), start nginx + Gunicorn. Once Alembic is introduced it runs
  `alembic upgrade head` first, so migrations apply automatically on every
  deploy.
- **`deploy/runtime-config.js`** — overwrites the dev API base with same-origin
  `/api` at image build time (the dev default in `ui/public/runtime-config.js`
  points at `http://localhost:8000`).

Because the UI and API share one origin, the browser makes no cross-origin
requests, so no CORS configuration is needed in the container. Keep the dev
CORS origins as-is; do **not** widen `allow_origins` to `["*"]` with credentials.

State is decoupled onto a mounted volume (`/data`); SQLite writes to
`/data/app.db` via `DATABASE_URL`. Build locally with `make image` /
`make run-container`. See `deploy/README.md` and `fly.toml` for the full
Fly.io deployment workflow.

---

## Local Development — Getting Started

```bash
# Backend
cd api
cp .env.example .env        # set JWT_SECRET at minimum
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
./dev.sh                     # uvicorn on :8000 with --reload

# Frontend
cd ui
cp .env.example .env
npm install
npm run dev                  # vite on :3000
```

That's the baseline. The backend exposes `/auth/login` and `/users/me`. The frontend renders a login page, stores the token, and makes authenticated requests. Everything above that is application-specific and built on top of this foundation.

---

## Dependency Versions

> **These numbers are directional, not authoritative.** The source of truth for exact versions is `api/requirements.txt` / `api/pyproject.toml` and `ui/package.json`. Treat this table as "install current within this major line"; don't hand-sync it on every dependency bump.

| Package | Version |
|---|---|
| Python | 3.12 |
| FastAPI | 0.115.x |
| SQLAlchemy | 2.0.x |
| aiosqlite | 0.20.x |
| Alembic | 1.18.x |
| Pydantic v2 | 2.10.x |
| pydantic-settings | 2.8.x |
| fastapi-users | 14.x |
| Uvicorn | 0.34.x |
| Gunicorn | 23.x |
| pytest | 9.x |
| Node | LTS |
| React | 18.3.x |
| Vite | 6.x |
| Tailwind CSS | 3.4.x |
| shadcn/ui | CLI (components vendored) |
| Radix UI | latest |
| react-day-picker | 9.x |
| Redux Toolkit | 2.6.x |
| React Router DOM | 6.x |
| Axios | 1.7.x |
| Day.js | 1.11.x |
| Vitest | 3.x |

---

## Agent Handoff Spec

Everything above is the human-readable stack reference. This section is the executable contract: it gives an agent enough to scaffold, build a feature, and verify it without guessing. When these instructions and a functional requirements document are provided together, the agent has what it needs to deliver.

### 1. Canonical file skeleton

Create these files first, with this starting content, before any feature work.

`app/settings.py`
```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    jwt_secret: str                        # no default — app must not boot without it
    database_url: str = "sqlite+aiosqlite:///./data/app.db"
    cors_origins: str = "http://localhost:3000"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache()
def get_settings() -> Settings:
    return Settings()
```

`app/database.py`
```python
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.settings import get_settings

class Base(DeclarativeBase):
    pass

engine = create_async_engine(get_settings().database_url)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
```

`app/models.py`
```python
from datetime import datetime
from uuid import UUID
from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class UserRecord(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"
    name: Mapped[str] = mapped_column(default="")

class SoftDeleteMixin:
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

`app/users.py` — fastapi-users setup (user manager, JWT strategy, `auth_backend`, `fastapi_users`, `current_active_user`). See the Authentication section above for the full pattern.

`app/dependencies.py`
```python
# Ownership helper: load a row and confirm it belongs to the caller.
# Return 404 (not 403) for missing/foreign/soft-deleted rows so existence isn't leaked.
```

`app/main.py` — `create_app()` factory: fail-fast on missing `JWT_SECRET`, CORS from `cors_origins`, mount fastapi-users auth + register routers, then each feature router.

`tests/conftest.py`
```python
# - in-memory async SQLite engine (sqlite+aiosqlite://) with StaticPool
# - create_all on Base.metadata per test session
# - httpx.AsyncClient bound to the app
# - override current_active_user with a seeded test user
```

### 2. New-feature recipe (worked example: a `notes` resource)

Follow these steps in order for every new resource. Each step names the file it touches.

1. **Model** — add to `app/models.py`:
   ```python
   class NoteRecord(SoftDeleteMixin, Base):
       __tablename__ = "notes"
       note_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
       user_id: Mapped[UUID] = mapped_column(
           Uuid(as_uuid=False), ForeignKey("users.id"), index=True
       )
       body: Mapped[str] = mapped_column(String)
   ```
2. **Schemas** — separate Pydantic request/response models with camelCase aliases:
   ```python
   class NoteCreate(BaseModel):
       body: str
       model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

   class NoteRead(BaseModel):
       note_id: str
       body: str
       model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
   ```
3. **Router** — `app/routers/notes.py`, thin async handlers, ownership enforced:
   ```python
   router = APIRouter(prefix="/notes", tags=["notes"])

   @router.get("/", response_model=list[NoteRead])
   async def list_notes(
       db: AsyncSession = Depends(get_db),
       user: UserRecord = Depends(current_active_user),
   ):
       rows = await db.scalars(
           select(NoteRecord).where(NoteRecord.user_id == user.id, active(NoteRecord))
       )
       return list(rows)
   ```
4. **Register** — add `application.include_router(notes.router)` in `create_app()`.
5. **Test** — `tests/test_notes.py`: happy path plus at least one ownership failure (another user's note returns 404).
6. **Verify** — run the gates in §4; all must pass before the feature is done.

### 3. Contracts

**Environment variables**

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `JWT_SECRET` | **Boot-failing** | — | No default; app refuses to start without it |
| `DATABASE_URL` | Defaulted | `sqlite+aiosqlite:///./data/app.db` | Any SQL-compliant async URL |
| `CORS_ORIGINS` | Defaulted | `http://localhost:3000` | Comma-separated allowlist |
| `VITE_API_BASE_URL` (ui) | Defaulted | `http://localhost:8000` | Frontend → backend base URL |

**Auth endpoints provided by fastapi-users** (mount these; don't hand-roll them)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Form login → `{ access_token, token_type }` |
| POST | `/auth/logout` | Logout (no-op with stateless JWT) |
| POST | `/auth/register` | Create user → `UserRead` |
| GET | `/users/me` | Current user (users router) |
| PATCH | `/users/me` | Update current user |

**Admin endpoints** (behind `current_superuser`, under the `/admin` prefix)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/users` | List all users → `list[UserRead]` (403 for non-admin, 401 for anonymous) |

**Wire format**

- All request/response bodies are camelCase on the wire, snake_case in Python, via Pydantic `alias_generator=to_camel` + `populate_by_name=True`. Exception: the fastapi-users user schemas (`UserRead`/`UserCreate`/`UserUpdate`, used by `/auth/register`, `/users/me`, `/admin/users`) stay snake_case — fastapi-users owns them.
- IDs exposed to clients are UUIDs (strings on the wire).
- Timestamps are ISO-8601 UTC. Instants use the `UtcDateTime` column type so the offset survives SQLite; wall-clock times (no offset) are a separate `time` type.

### 4. Verification gates

A feature is not done until all of these pass. Run them and cite the output.

```bash
# Backend
cd api
ruff check .
ruff format --check .
mypy
pytest

# Frontend
cd ui
npm run lint
npm run test:run
npm run build
```

### 5. Acceptance checklist (per feature)

- [ ] Model added with `user_id` FK (indexed) and `SoftDeleteMixin` where applicable
- [ ] Separate Pydantic request/response schemas with camelCase aliases
- [ ] Router is thin, `async`, and enforces ownership (404 for missing/foreign/deleted)
- [ ] Router registered in `create_app()`
- [ ] Non-trivial logic lives in `services/`, not the handler
- [ ] Test covers happy path **and** at least one auth/ownership failure
- [ ] All §4 verification gates pass

### 6. Invariants an agent must not violate

- **Async only** — never introduce a sync `Session`/`create_engine`.
- **UUID primary keys** for anything exposed to clients — never sequential ints.
- **Soft delete** (`is_deleted`/`deleted_at`) — never hard-delete domain rows.
- **404, not 403**, for missing/foreign/deleted resources — don't leak existence.
- **camelCase on the wire, snake_case in Python.**
- **Thin routers** — business logic belongs in `services/`.
- **fastapi-users owns auth** — don't hand-roll login, hashing, or token logic.
- **`JWT_SECRET` has no default** — the app must fail fast if it is missing.
