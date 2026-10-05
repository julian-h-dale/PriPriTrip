# PriPriTrip

A trip itinerary as a clean, expandable day-by-day timeline. Each trip is one
JSON document: upload it, and the app renders it.

Built on [project-template](https://github.com/julian-h-dale/project-template):
**FastAPI (async) + SQLite + React (Vite) + Redux Toolkit + Tailwind/shadcn.**
This is a ground-up rebuild of v1. See [docs/lessons_learned.md](docs/lessons_learned.md)
for what we learned, and [reference/](reference/) for v1 material.

- What we're building: [functional_spec.md](functional_spec.md)
- How, phase by phase: [implementation_plan.md](implementation_plan.md)
- Where we are: [PROGRESS.md](PROGRESS.md)

## For agents

Read [AGENTS.md](AGENTS.md) first. It defines the source-of-truth docs and the
phased build workflow.

## Quick start

```bash
make setup                       # backend venv + npm install (creates api/.env with a generated JWT_SECRET)
make seed                        # seed users + sample data
make dev                         # API on :8000 + UI on :3000 (Ctrl-C stops both)
                                 # or separately: make dev-api / make dev-ui
```

Log in with the seeded credentials from `api/.env`:

- **User:** `user@example.com` / `changeme-user`
- **Admin:** `admin@example.com` / `changeme-admin` (`is_superuser`) — sees an
  **Admin** button linking to the `/admin` user listing

## Working on two things at once

Each idea gets its own worktree — its own directory, branch off `main`, port
pair, `.env` files and database — so a spike never disturbs the main checkout:

```bash
make worktree NAME=billing-export   # API :8001, UI :3001, app-billing-export.db
make worktree-list                  # what's checked out where
make worktree-rm NAME=billing-export
```

Worktrees live beside the repo, grouped in one disposable folder:

```
development/
├── project-template/                 <- this repo, untouched
└── project-template-worktrees/
    ├── billing-export/               <- :8001 / :3001
    └── oauth-spike/                  <- :8002 / :3002
```

The script installs dependencies and seeds the database, so the worktree is
ready to `make dev-api` / `make dev-ui` when it finishes. See
[scripts/new-worktree.sh](scripts/new-worktree.sh).

## Layout

```
api/                 FastAPI backend (async SQLAlchemy, fastapi-users, pytest)
ui/                  React SPA (Vite, Redux Toolkit, Tailwind + shadcn, Vitest)
templates/           functional_spec + implementation_plan templates
deploy/              unified-container assets (nginx, entrypoint, runtime config)
scripts/             worktree + template-update helpers
.claude/skills/      skills for Claude Code (new-worktree)
Dockerfile           unified single-container image (UI + API behind one nginx)
fly.toml             Fly.io deployment config
AGENTS.md            agent working agreement + workflow
design_doc.md        visual + interaction direction
quickstart_technical.md   stack + conventions reference
PROGRESS.md          resumable session state
Makefile             canonical commands (setup, seed, dev, test, verify, image)
```

## Deploy

The app ships as a single unified container (UI + API behind one nginx),
deployable to a single Fly.io Machine. See [deploy/README.md](deploy/README.md).

## Back up or move a trip

A trip exports as a trip document: the JSON that import takes (see
`schema/trip.schema.json`). It is the **plan** only — trip, stays, travel, days
and activities — not the journal (memories and photos), members or share codes.
Anyone who can view a trip can export it.

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

## Photo backup to the Pi

A Raspberry Pi at home copies every journal photo (the full-quality original)
and each trip's journal (`journal.json`: every memory's text, time, place and
photos) from the Fly app to a USB drive, every 30 minutes. It only pulls from
`https://pripri-trip.fly.dev/api`, so nothing needs to reach the Pi (Tailscale
is only for reaching it yourself). Nothing is ever deleted from the drive.

```
/mnt/pripri-backup/PriPriTrip/
  okinawa-taipei-trip-fall-2026/
    2026-10-30/1805_julian_3f2b8c1e.jpg     # <local time>_<author>_<photo id>
    journal.json
  state.json                                # where the last run got to
```

**1. A backup account.** A superuser used only by the Pi, so it can be turned
off without touching yours. Invite it from the app (☰ on the trips screen →
Invite someone, e.g. `backup@…`), sign in as it once to choose its password,
then make it a superuser on Fly:

```bash
fly ssh console -C "python -m app.make_admin backup@…"
```

**2. The drive** (ext4: it stays plugged into the Pi). **Formatting erases
it** — check the device name with `lsblk` first.

```bash
lsblk                                         # find it, e.g. /dev/sda
sudo parted /dev/sda --script mklabel gpt mkpart backup ext4 0% 100%
sudo mkfs.ext4 -L pripri-backup /dev/sda1
sudo mkdir -p /mnt/pripri-backup
echo "UUID=$(sudo blkid -s UUID -o value /dev/sda1) /mnt/pripri-backup ext4 defaults,noatime,nofail,x-systemd.device-timeout=10s 0 2" | sudo tee -a /etc/fstab
sudo systemctl daemon-reload && sudo mount /mnt/pripri-backup
sudo chown "$USER": /mnt/pripri-backup
```

`nofail` lets the Pi boot without the drive. Without it mounted, the backup
refuses to run rather than filling the SD card.

**3. Install and fill in the account:**

```bash
make pi-backup-install                        # sudo; the timer runs as you
sudo nano /etc/pripri-backup.env              # BACKUP_EMAIL, BACKUP_PASSWORD
make pi-backup-run                            # one run now, and its log
journalctl -u pripri-backup -n 20             # later: "3 new photos (41.2 MB), …"
systemctl list-timers pripri-backup.timer     # when it runs next
```

Run `make pi-backup-install` again after pulling changes to the script. Photos
still waiting on a phone (not uploaded yet) aren't on the server, so they're
backed up once uploaded.

## Verify everything

```bash
make verify          # lint + test, backend and frontend
```

## The build workflow

1. Create `functional_spec.md` from `templates/functional_spec.template.md`.
2. Agent verifies the baseline, then writes a phased `implementation_plan.md`
   (crawl → walk → run stages, one or more phases each, every phase testable)
   ending in open questions.
3. You answer the open questions inline.
4. Agent executes one phase at a time, running `make verify` and waiting for your
   confirmation between phases.

See [AGENTS.md](AGENTS.md) for the full agreement.
