#!/usr/bin/env bash
# ==============================================================================
# rm-worktree.sh
#
# Tear down a worktree created by scripts/new-worktree.sh: remove the directory
# (with its venv, node_modules and SQLite database) and delete the branch.
# Worktrees accumulate fast, so teardown should be as cheap as creation.
#
# Usage (from anywhere inside the repo or one of its worktrees):
#     bash scripts/rm-worktree.sh billing
#     bash scripts/rm-worktree.sh billing --force        # discard local changes
#     bash scripts/rm-worktree.sh billing --keep-branch  # directory only
#
# By default this refuses to run when the worktree has uncommitted changes or
# the branch has commits that aren't merged into main.
# ==============================================================================
set -euo pipefail

FORCE=0
KEEP_BRANCH=0
NAME=""

die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)       FORCE=1; shift ;;
    --keep-branch) KEEP_BRANCH=1; shift ;;
    -h|--help)     sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
    -*)            die "unknown option: $1" ;;
    *)
      [[ -n "$NAME" ]] && die "unexpected argument: $1"
      NAME="$1"; shift ;;
  esac
done

[[ -n "$NAME" ]] || die "usage: bash scripts/rm-worktree.sh <name> [--force] [--keep-branch]"

git rev-parse --git-common-dir >/dev/null 2>&1 || die "not inside a git repository."
GIT_COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
MAIN_REPO="$(dirname "$GIT_COMMON_DIR")"
REPO_NAME="$(basename "$MAIN_REPO")"
WORKTREE_ROOT="${WORKTREE_ROOT:-$(dirname "$MAIN_REPO")/${REPO_NAME}-worktrees}"

# Accept either a slug or a path.
if [[ -d "$NAME" ]]; then
  WT_DIR="$(cd "$NAME" && pwd)"
else
  WT_DIR="${WORKTREE_ROOT}/${NAME}"
fi

[[ "$WT_DIR" == "$MAIN_REPO" ]] && die "that's the main checkout, not a worktree."

git -C "$MAIN_REPO" worktree list --porcelain | sed -n 's/^worktree //p' \
  | grep -qxF "$WT_DIR" \
  || die "not a registered worktree of this repo: $WT_DIR"

BRANCH="$(git -C "$WT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

# --- safety checks ------------------------------------------------------------
if [[ "$FORCE" != "1" ]]; then
  if [[ -n "$(git -C "$WT_DIR" status --porcelain)" ]]; then
    die "worktree has uncommitted changes. Commit them, or re-run with --force."
  fi
  if [[ -n "$BRANCH" && "$KEEP_BRANCH" != "1" ]]; then
    UNMERGED="$(git -C "$MAIN_REPO" rev-list --count "main..${BRANCH}" 2>/dev/null || echo 0)"
    if [[ "$UNMERGED" != "0" ]]; then
      die "branch '${BRANCH}' has ${UNMERGED} commit(s) not in main. Merge/push them, or re-run with --force (or --keep-branch)."
    fi
  fi
fi

# --- remove -------------------------------------------------------------------
echo "Removing worktree ${WT_DIR}"
if [[ "$FORCE" == "1" ]]; then
  git -C "$MAIN_REPO" worktree remove --force "$WT_DIR"
else
  git -C "$MAIN_REPO" worktree remove "$WT_DIR"
fi
git -C "$MAIN_REPO" worktree prune

if [[ "$KEEP_BRANCH" != "1" && -n "$BRANCH" ]]; then
  if [[ "$FORCE" == "1" ]]; then
    git -C "$MAIN_REPO" branch -D "$BRANCH"
  else
    git -C "$MAIN_REPO" branch -d "$BRANCH"
  fi
  echo "Deleted branch ${BRANCH}"
fi

# Tidy up the container folder once the last worktree is gone.
rmdir "$WORKTREE_ROOT" 2>/dev/null && echo "Removed empty ${WORKTREE_ROOT}"

echo "Done."
