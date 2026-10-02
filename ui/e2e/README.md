# E2E (Playwright)

Practical, screenshot-first checks against a real running app: page views and
basic clicking, nothing more. No visual-diff baselines — the UI is still
changing a lot, so these stay light on purpose. Not part of `make verify`;
run them yourself when you want to see the app without being at a screen.

```bash
make dev              # if not already running
cd ui && npm run test:e2e
```

Screenshots land in `e2e/screenshots/` (gitignored), overwritten each run:
`01-trips-list.png`, `02-trip-timeline.png`, `03-day-detail.png`,
`04-day-detail-entry-expanded.png`.

Runs against the seeded sample trip ("Bern & Wengen Long Weekend"), so
`make seed` must have run at least once. Logs in as the seed dev user
(`SEED_USER_EMAIL`/`SEED_USER_PASSWORD` env vars, defaulting to the same
values `api/.env` ships with).
