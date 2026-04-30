#!/usr/bin/env bash
# Download trip.json from Azure Blob Storage and commit it to the repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-stpripritripprod}"
CONTAINER="trip"
BLOB="trip.json"
DEST="$REPO_ROOT/data/trip.json"

echo ">> Downloading $BLOB from storage account '$STORAGE_ACCOUNT'..."
az storage blob download \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "$BLOB" \
  --file "$DEST" \
  --auth-mode login \
  --overwrite \
  --output none

echo ">> Downloaded to $DEST"

# Commit only if there are actual changes
cd "$REPO_ROOT"
if git diff --quiet -- data/trip.json; then
  echo ">> No changes to trip.json — nothing to commit."
else
  TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
  git add data/trip.json
  git commit -m "chore: snapshot trip.json ($TIMESTAMP)"
  echo ">> Committed trip.json snapshot."
fi
