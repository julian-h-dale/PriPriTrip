#!/usr/bin/env bash
# Install (or update) the PriPriTrip photo backup on this Raspberry Pi:
# the script under /opt/pripri-backup, the systemd service and 30-minute
# timer, and /etc/pripri-backup.env (created once from the example; never
# overwritten, since it holds the password).
#
#   sudo scripts/pi-backup/install.sh            # runs as the user who called sudo
#   sudo BACKUP_USER=pi scripts/pi-backup/install.sh
#
# The drive must be formatted, mounted and owned by that user first — see
# README.md, "Photo backup to the Pi".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=/etc/pripri-backup.env

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi
USER_NAME="${BACKUP_USER:-${SUDO_USER:-}}"
if [[ -z "$USER_NAME" || "$USER_NAME" == root ]]; then
  echo "Say which user runs the backup: sudo BACKUP_USER=<user> $0" >&2
  exit 1
fi
id "$USER_NAME" >/dev/null

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 600 -o root -g root "$HERE/pripri-backup.env.example" "$ENV_FILE"
  CREATED_ENV=1
fi
BACKUP_DIR="$(sed -n 's/^BACKUP_DIR=//p' "$ENV_FILE" | tail -1)"
BACKUP_DIR="${BACKUP_DIR:-/mnt/pripri-backup}"

# The mount point must exist for the service's sandbox, drive or not.
[[ -d "$BACKUP_DIR" ]] || install -d -m 755 "$BACKUP_DIR"
install -d -m 755 /opt/pripri-backup
install -m 755 "$HERE/pripri_backup.py" /opt/pripri-backup/pripri_backup.py
sed -e "s|@USER@|$USER_NAME|g" -e "s|@BACKUP_DIR@|$BACKUP_DIR|g" \
  "$HERE/pripri-backup.service" > /etc/systemd/system/pripri-backup.service
install -m 644 "$HERE/pripri-backup.timer" /etc/systemd/system/pripri-backup.timer
systemctl daemon-reload
systemctl enable --now pripri-backup.timer

echo "Installed: runs as $USER_NAME every 30 minutes, backing up to $BACKUP_DIR."
if [[ -n "${CREATED_ENV:-}" ]]; then
  echo "Next: fill in BACKUP_EMAIL and BACKUP_PASSWORD in $ENV_FILE (sudo nano $ENV_FILE)."
fi
mountpoint -q "$BACKUP_DIR" || echo "Warning: $BACKUP_DIR isn't mounted yet; runs will fail until it is."
echo "Run one now:   sudo systemctl start pripri-backup"
echo "See the logs:  journalctl -u pripri-backup -n 20"
