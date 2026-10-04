---
name: new-worktree
description: Create or tear down an isolated git worktree for this project so a second idea can be built and run in parallel. Each worktree gets its own directory, branch off main, port pair, env files and SQLite database. Use when the user wants to spin up a parallel workstream, try an idea without disturbing the main checkout, work on two features at once, or clean up a worktree afterwards.
---

# Parallel worktrees

This project can run several checkouts side by side, each with its own branch,
ports and database, so an experiment never disturbs the main checkout. The
mechanics live in `scripts/new-worktree.sh`; this skill is about using it well.

## Creating one

```bash
bash scripts/new-worktree.sh <name>          # or: make worktree NAME=<name>
```

**Pick the name yourself** from what the user described, unless they gave one.
Short, lowercase, hyphenated, and about the *work* rather than the mechanism —
`billing-export`, `oauth-spike`, `fix-tz-drift`. It becomes both the branch name
and the directory name. Say which name you chose in your reply.

The script is the whole job. Do not hand-roll `git worktree add`, and do not
edit ports or env files yourself afterwards — everything below is already done:

| | |
|---|---|
| Directory | `<repo>/../<repo-name>-worktrees/<name>/` |
| Branch | fresh, cut from `main` |
| Ports | next free slot — API `8000+N`, UI `3000+N` (main checkout is slot 0) |
| Env | `api/.env` + `ui/.env` copied from the main checkout, ports rewritten |
| Database | its own `api/data/app-<name>.db`, freshly seeded |
| Deps | `make setup` has run — venv and `node_modules` are in place |

Useful flags: `--from <ref>` to branch off something other than `main`,
`--no-setup` to skip the dependency install (~1–2 minutes) when the user only
wants the directory, `--api-port` / `--ui-port` to force a specific pair.

**It takes a couple of minutes**, almost all of it `pip install` and
`npm install`. Run it in the foreground and let it finish rather than
backgrounding it — a half-installed worktree is worse than none.

## After it finishes

Report the directory and both port numbers, then give the user the command to
open a session there:

```
cd <worktree dir> && claude
```

The new worktree is a **separate** checkout. This session stays in the current
one — you cannot `cd` into the worktree and keep working there. If the user
wants work done inside it, they open a session in that directory.

## Working inside a worktree

If this session *is* running inside a worktree, its ports are not 8000/3000.
Read them before referring to a URL, starting a server, or curling an endpoint:

```bash
sed -n 's/^API_PORT=//p' api/.env      # API
sed -n 's/^VITE_UI_PORT=//p' ui/.env   # UI
```

`make dev-api` and `make dev-ui` already read these, so the commands themselves
are unchanged. `make run-container` still binds 8080 — pass
`make run-container HOST_PORT=<n>` if another worktree holds it.

## Listing and removing

```bash
make worktree-list                              # git worktree list
bash scripts/rm-worktree.sh <name>              # remove directory + branch
bash scripts/rm-worktree.sh <name> --keep-branch
bash scripts/rm-worktree.sh <name> --force      # discard uncommitted work
```

Removal deletes the venv, `node_modules` and that worktree's database. It
refuses by default when there are uncommitted changes or commits not yet in
`main` — **relay that refusal to the user and let them decide**. Never reach for
`--force` on your own; it is how an afternoon's uncommitted work disappears.
