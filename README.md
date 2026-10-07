# PriPriTrip

A family trip app for the phone: the itinerary as a day-by-day timeline,
Today's plan and tonight's stay, a map, a shared journal with photos, and
trip tools (currency, weather, time zones, packing, documents). It works
offline and installs as an app (PWA). Each trip is one JSON document:
import it, and the app renders it.

Built on [project-template](https://github.com/julian-h-dale/project-template):
**FastAPI (async) + SQLite + React (Vite) + Redux Toolkit + Tailwind/shadcn.**
This is a ground-up rebuild of v1. See
[docs/lessons_learned.md](docs/lessons_learned.md) for what we learned, and
[reference/](reference/) for v1 material.

## The parts, and how to run each

| Part | What it is | How to run it | Details |
|---|---|---|---|
| **API** | FastAPI + SQLite (Alembic migrations), on `:8000` | `make dev-api` | [api/README.md](api/README.md) |
| **UI** | React PWA (Vite), on `:3000` | `make dev-ui` | [ui/README.md](ui/README.md) |
| **Both together** | API + UI in one terminal | `make dev` | below |
| **Browser checks** | Playwright, phone width, screenshots | `cd ui && npm run test:e2e` | [ui/e2e/README.md](ui/e2e/README.md) |
| **Production** | One container (nginx + UI + API) on Fly.io | `fly deploy` | [deploy/README.md](deploy/README.md) |
| **Photo backup** | A Raspberry Pi pulling photos and journals every 30 min | `make pi-backup-install` (on the Pi) | [scripts/pi-backup/README.md](scripts/pi-backup/README.md) |
| **Usage analytics** | Page views and Trip tools usage to an Umami instance | set `UMAMI_URL` / `UMAMI_WEBSITE_ID` | [Analytics](#usage-analytics) |
| **Trip backup / move** | Export a trip as its JSON document | `make export-trip TRIP=<id>` | [below](#back-up-or-move-a-trip) |

## Quick start (local)

Needs Python 3.12+ and Node (LTS).

```bash
make setup     # backend venv + npm install; creates api/.env with a generated JWT_SECRET
make seed      # seed users + the sample trips (safe to re-run: it replants them)
make dev       # API on :8000 + UI on :3000 (Ctrl-C stops both)
```

Open http://localhost:3000 and sign in with a seed account. The passwords
are in `api/.env` (`SEED_*_PASSWORD`); the defaults are:

| Account | Default password | What it shows |
|---|---|---|
| `user@example.com` | `changeme-user` | The owner of the sample trips |
| `pripri@example.com` | `changeme-viewer` | A **viewer** of the sample trips (Timeline, Journal, Map) |
| `admin@example.com` | `changeme-admin` | An **admin**: the Admin page (users, invites, roles, analytics) |

Optional keys in `api/.env` turn features on; without them those features
say they aren't set up:

| Setting | Turns on |
|---|---|
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID` | The map, place search, mini maps, place photos |
| `OPENWEATHER_API_KEY` | The Weather tool |
| `UMAMI_URL`, `UMAMI_WEBSITE_ID` | Usage analytics |

See [api/.env.example](api/.env.example) for every setting, with notes.

Other everyday commands:

```bash
make verify     # lint + test everything (the gate before a phase is done)
make migrate    # bring the dev database up to the latest schema
make reset-db   # delete the dev database, migrate, re-seed (then restart make dev)
make help       # every make target
```

## Usage analytics

Page views (by page name, never the address) and Trip tools usage go to an
[Umami](https://umami.is) instance, each tagged with the person's role on
the trip (owner, editor, viewer). Nothing personal is sent: no names,
emails, trip names or ids.

- **Turn it on:** set `UMAMI_URL` and `UMAMI_WEBSITE_ID` (in `api/.env`
  locally, as Fly secrets in production). Empty, nothing is sent.
- **Who is counted:** an On / Off switch per person on the Admin page. New
  users start on and new admins off; after that only an admin changes it.
- **Offline:** events wait on the phone and are sent, with the time they
  happened, when there's a connection again.
- **Reading it:** in Umami, Pages lists `/trip/map` and the rest; add a
  **Tag** filter to split by role. Events lists the tools (`tool-open`,
  `currency-convert`, `packing-check`, …).
- Design and decisions: [Run 18](docs/plan/run-18-analytics.md),
  [Run 19](docs/plan/run-19-offline-analytics.md).

## Back up or move a trip

A trip exports as a trip document: the JSON that import takes (see
`schema/trip.schema.json`). It is the **plan** only (trip, stays, travel,
days, activities, points of interest), not the journal (memories and
photos), members or share codes. Anyone who can view a trip can export it.

```bash
export TRIP_EMAIL=you@example.com TRIP_PASSWORD=...   # password is asked for if unset
make list-trips                                       # ids, dates, names
make export-trip TRIP=<id>                            # -> exports/<trip-name>.json
make export-trip TRIP=<id> OUT=-                      # to stdout instead
make export-trip TRIP=<id> API_URL=https://pripri-trip.fly.dev/api   # the deployed app
```

`API_URL` defaults to the local API (the port in `api/.env`). To move a trip,
import the file in the other environment (the Import button, or
`POST /trips/import`): it always creates a new trip with a new id.
`exports/` is git-ignored because a backup holds confirmation numbers.

## Working on two things at once

Each idea gets its own worktree: its own directory, branch off `main`, port
pair, `.env` files and database, so a spike never disturbs the main checkout.

```bash
make worktree NAME=data-saver     # API :8001, UI :3001, api/data/app-data-saver.db
make worktree-list                # what's checked out where
make worktree-rm NAME=data-saver
```

Worktrees live beside the repo in `../PriPriTrip-worktrees/<name>/`. Inside
one, the ports aren't 8000/3000: read them from `api/.env` (`API_PORT`) and
`ui/.env` (`VITE_UI_PORT`). See [scripts/new-worktree.sh](scripts/new-worktree.sh).

## Layout

```
api/                 FastAPI backend (async SQLAlchemy, fastapi-users, Alembic, pytest)  -> api/README.md
ui/                  React PWA (Vite, Redux Toolkit, Tailwind + shadcn, Vitest)          -> ui/README.md
ui/e2e/              Playwright browser checks at phone width                             -> ui/e2e/README.md
deploy/              unified-container assets (nginx, entrypoint, runtime config)         -> deploy/README.md
scripts/pi-backup/   the Raspberry Pi photo + journal backup                              -> scripts/pi-backup/README.md
scripts/             worktree, trip export, icon and template-update helpers
schema/              trip.schema.json (generated: make schema)
docs/plan/           one plan per stage (implementation_plan.md is the index)
docs/                lessons learned, how photos work, reviews, progress history
templates/           functional_spec + implementation_plan templates
reference/           v1 material and personal trip notes
Dockerfile, fly.toml the production image and its Fly.io config
Makefile             the canonical commands (make help)
```

## The documents

| Doc | For |
|---|---|
| [functional_spec.md](functional_spec.md) | What we're building |
| [implementation_plan.md](implementation_plan.md) | The stages, phase by phase (an index into [docs/plan/](docs/plan/)) and the backlog |
| [PROGRESS.md](PROGRESS.md) | Where we are now (older entries: [docs/progress-history.md](docs/progress-history.md)) |
| [design_doc.md](design_doc.md) | Look and interaction rules |
| [quickstart_technical.md](quickstart_technical.md) | The stack and its conventions |
| [docs/photos.md](docs/photos.md) | A photo's life, phone to Pi |
| [docs/ui-review-2026-10-07.md](docs/ui-review-2026-10-07.md) | The latest usability review (in the field) |
| [AGENTS.md](AGENTS.md) | The working agreement for coding agents: read it first |

## The build workflow

1. `functional_spec.md` says what to build.
2. Each stage gets a plan in `docs/plan/` (phases, tests, open questions).
3. The open questions are answered inline before any phase starts.
4. One phase at a time: `make verify` green, `PROGRESS.md` updated, a
   commit, then confirmation before the next.

See [AGENTS.md](AGENTS.md) for the full agreement.
