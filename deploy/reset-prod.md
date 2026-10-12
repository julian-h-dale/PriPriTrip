# Reset production to a clean slate

Wipes everything on the Fly app `pripri-trip`: every account, trip,
memory, photo and document. There is **no backup step** and no undo. Run it
only when nothing in prod is worth keeping.

All state lives on the volume mounted at `/data`:

| Path | What |
|---|---|
| `/data/app.db` | The SQLite database: accounts, trips, memories, packing lists |
| `/data/photos/` | Journal photo files, one folder per trip |
| `/data/documents/` | Trip documents (tickets, scans), if any were uploaded |

The machine itself holds nothing: on boot, `deploy/start.sh` migrates
(creating a fresh, empty database if there is none), then starts nginx and
the API. It never seeds.

## 1. Set real seed accounts (before the wipe)

`make seed-remote` creates the accounts named by the `SEED_*` secrets. With
none set, it falls back to the example ones (`user@example.com` /
`changeme-user`, `admin@example.com` / `changeme-admin`) on a public URL.
Set real ones first. Run this in your own terminal so the passwords stay out
of chat logs and shell history (a leading space skips history in most
shells):

```bash
 fly secrets set -a pripri-trip \
   SEED_ADMIN_EMAIL=you@example.com     SEED_ADMIN_PASSWORD='…' \
   SEED_USER_EMAIL=user@example.com     SEED_USER_PASSWORD='…' \
   SEED_VIEWER_EMAIL=viewer@example.com SEED_VIEWER_PASSWORD='…'
```

Setting secrets restarts the machine. `fly secrets list -a pripri-trip`
shows which are set (never their values).

## 2. Wipe the data

```bash
fly ssh console -a pripri-trip -C "sh -c 'rm -f /data/app.db && rm -rf /data/photos /data/documents && ls -la /data'"
```

`ls` should show only `lost+found`.

## 3. Restart, so the API starts on an empty database

```bash
fly machine list -a pripri-trip                       # the machine id
fly machine restart <machine-id> -a pripri-trip
curl https://pripri-trip.fly.dev/api/health           # {"status":"ok"}
```

The running API still had the old database open, so restart before signing
in. `start.sh` migrates a fresh one on boot.

## 4. Seed the accounts

```bash
make seed-remote
```

This creates the admin, user and viewer from step 1, plus the **sample
trip** (Bern & Wengen) and the **demo trip** (Chicago to Athens). If you
don't want those two trips, delete them in the app afterwards.

## 5. Check

```bash
fly ssh console -a pripri-trip -C "sh -c 'ls -la /data; df -h /data'"
```

Then sign in at https://pripri-trip.fly.dev as the admin, and invite
everyone else (PriPri too) from the Admin page.

## Afterwards

- Everyone who was signed in is signed out (their accounts are gone).
- An installed app may still show its saved copies of old trips until it
  refreshes. Signing out and in clears them.
- Analytics (Umami) keep their history; they're a separate service.

## Optional: grow the volume while you're at it

A volume only grows, never shrinks:

```bash
fly volumes list -a pripri-trip                       # the volume id
fly volumes extend <volume-id> -s 10 -a pripri-trip   # to 10 GB
fly ssh console -a pripri-trip -C "df -h /data"       # restart the machine if it still shows ~1G
```

To have a future, rebuilt volume start at the same size, add
`initial_size = "10gb"` under `[mounts]` in `fly.toml`.
