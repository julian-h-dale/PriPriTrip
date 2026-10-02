# Canonical commands. The agent (and you) should use these rather than
# reconstructing raw commands. See AGENTS.md for the workflow.

.PHONY: help env setup seed reset-db schema dev-api dev-ui image run-container test test-api test-ui lint lint-api lint-ui verify worktree worktree-list worktree-rm

help:
	@echo "Targets:"
	@echo "  setup         Install backend + frontend dependencies (creates api/.env)"
	@echo "  seed          Create seed users + sample data (idempotent)"
	@echo "  reset-db      Delete the dev SQLite database and re-seed"
	@echo "  schema        Regenerate schema/trip.schema.json from the Pydantic models"
	@echo "  dev-api       Run the API with reload (port from api/.env, default 8000)"
	@echo "  dev-ui        Run the UI dev server (port from ui/.env, default 3000)"
	@echo "  image         Build the unified single-container image"
	@echo "  run-container Run the unified image locally (:8080)"
	@echo "  test          Run all tests (api + ui)"
	@echo "  lint          Lint everything"
	@echo "  verify        Lint + test everything (use before advancing a phase)"
	@echo "  worktree      NAME=<name>  New worktree off main, own ports + database"
	@echo "  worktree-list List this repo's worktrees"
	@echo "  worktree-rm   NAME=<name>  Remove a worktree and its branch"

env:
	@test -f api/.env || (cp api/.env.example api/.env && \
	  python3 -c 'import secrets; print("JWT_SECRET="+secrets.token_urlsafe(48))' \
	  >> api/.env && echo "Created api/.env with a generated JWT_SECRET.")

setup: env
	cd api && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
	cd ui && npm install

seed:
	cd api && . .venv/bin/activate && python -m app.seed

# create_all will not add a column to a table that already exists; while
# Alembic is deferred, a schema change means dropping the dev database and
# re-seeding. This target does exactly that.
reset-db:
	rm -f api/data/app.db
	cd api && . .venv/bin/activate && python -m app.seed

# The trip-document JSON Schema is generated, never hand-edited. A test fails
# if the committed file drifts from the models.
schema:
	cd api && . .venv/bin/activate && python -m app.schema_export

dev-api:
	cd api && . .venv/bin/activate && ./dev.sh

dev-ui:
	cd ui && npm run dev

# Unified single-container image (UI + API behind one nginx). See deploy/README.md.
image:
	docker build -t app:latest .

# HOST_PORT lets a second worktree run its container without fighting for 8080.
HOST_PORT ?= 8080
run-container:
	docker run --rm -p $(HOST_PORT):8080 \
	  -e JWT_SECRET=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))') \
	  -e DATABASE_URL=sqlite+aiosqlite:////data/app.db \
	  app:latest

test-api:
	cd api && . .venv/bin/activate && pytest -q

test-ui:
	cd ui && npm run test:run

test: test-api test-ui

lint-api:
	cd api && . .venv/bin/activate && ruff check . && ruff format --check . && mypy

lint-ui:
	cd ui && npm run lint

lint: lint-api lint-ui

verify: lint test
	@echo "All checks passed."

# --- worktrees ----------------------------------------------------------------
# Parallel workstreams: each worktree gets its own directory, branch, port pair
# and SQLite database. See scripts/new-worktree.sh.

worktree:
	@test -n "$(NAME)" || { echo "usage: make worktree NAME=<name>"; exit 1; }
	@bash scripts/new-worktree.sh "$(NAME)"

worktree-list:
	@git worktree list

worktree-rm:
	@test -n "$(NAME)" || { echo "usage: make worktree-rm NAME=<name>"; exit 1; }
	@bash scripts/rm-worktree.sh "$(NAME)"
