#!/usr/bin/env bash
# ==============================================================================
# adopt-template-updates.sh
#
# Pull later template improvements into an app that was forked from this
# template. Downstream apps share this template's git history, so we fetch the
# template as a git remote and copy the generic, app-agnostic files verbatim
# (the deployment stack + the admin UI components). Everything that needs to be
# wired into app-specific code is left to a short manual checklist — see
# MIGRATION.md.
#
# Run it from the ROOT of the target app (the downstream repo), not here:
#     cd /path/to/your-app
#     bash /path/to/project-template/scripts/adopt-template-updates.sh
#
# Override the source with env vars when testing locally or using a fork:
#     TEMPLATE_REMOTE=/path/to/project-template bash .../adopt-template-updates.sh
# ==============================================================================
set -euo pipefail

TEMPLATE_REMOTE="${TEMPLATE_REMOTE:-git@github.com:julian-h-dale/project-template.git}"
TEMPLATE_REF="${TEMPLATE_REF:-main}"
BRANCH="${BRANCH:-chore/adopt-template-updates}"

# Generic files, safe to copy verbatim — no app-specific content lives here.
DEPLOY_PATHS=(
  Dockerfile
  .dockerignore
  fly.toml
  deploy
  .github/workflows/ci.yml
)

# Parallel worktrees: the scripts and the skill are self-contained. Making the
# ports actually configurable touches four app files and stays manual — see
# MIGRATION.md.
WORKTREE_PATHS=(
  scripts/new-worktree.sh
  scripts/rm-worktree.sh
  .claude/skills/new-worktree/SKILL.md
)

# Admin UI: these three files are self-contained. The wiring (store, router,
# nav button, test) is app-specific and stays manual — see MIGRATION.md.
ADMIN_PATHS=(
  ui/src/features/admin/adminSlice.js
  ui/src/features/admin/AdminUsersPage.jsx
  ui/src/shared/components/AdminRoute.jsx
)

# --- guards -------------------------------------------------------------------
git rev-parse --show-toplevel >/dev/null 2>&1 \
  || { echo "error: run this from inside the target app's git repo." >&2; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean. Commit or stash first." >&2
  exit 1
fi

# --- fetch the template -------------------------------------------------------
if ! git remote get-url template >/dev/null 2>&1; then
  echo "Adding 'template' remote -> ${TEMPLATE_REMOTE}"
  git remote add template "$TEMPLATE_REMOTE"
fi
git fetch --quiet template "$TEMPLATE_REF"

# --- work on a dedicated branch ----------------------------------------------
git switch -c "$BRANCH" 2>/dev/null || git switch "$BRANCH"
echo "On branch: $BRANCH"

copy_paths() {
  local ref="template/${TEMPLATE_REF}"
  for path in "$@"; do
    if git cat-file -e "${ref}:${path}" 2>/dev/null; then
      git checkout "$ref" -- "$path"
      echo "  copied  $path"
    else
      echo "  skip    $path (not present in template)"
    fi
  done
}

echo "Copying deployment stack..."
copy_paths "${DEPLOY_PATHS[@]}"

echo "Copying admin UI components (wiring is manual)..."
copy_paths "${ADMIN_PATHS[@]}"

echo "Copying worktree tooling (port wiring is manual)..."
copy_paths "${WORKTREE_PATHS[@]}"

cat <<'EOF'

Files copied and staged. Remaining manual steps (details + snippets in MIGRATION.md):

  1. ui/src/app/store.js  — import adminReducer and add `admin: adminReducer`.
  2. ui/src/app/App.jsx   — add the /admin <Route> wrapped in <AdminRoute>.
  3. Home page            — add a superuser-only control that navigates to /admin.
  4. Makefile             — add the `image` and `run-container` targets.
  5. fly.toml             — set `app` and `primary_region` for your Fly app.
  6. Admin UI test        — add one adapted to your app's home page + reducers.
  7. Worktree ports       — make the dev ports env-driven, or the worktree
                            scripts will hand out ports nothing listens on:
                            api/dev.sh, ui/vite.config.js, api/.env.example,
                            ui/.env.example, ui/src/shared/config/appConfig.js.
  8. Makefile             — add the worktree / worktree-list / worktree-rm targets.
  9. Verify               — `make verify`, then `make image && make run-container`
                            and confirm you can log in as the seeded admin.

Review with `git status` / `git diff --staged`, then commit.
EOF
