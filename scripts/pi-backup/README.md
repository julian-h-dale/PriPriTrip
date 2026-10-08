# Photo backup to the Pi

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

| File | What it is |
|---|---|
| [pripri_backup.py](pripri_backup.py) | The backup itself (signs in, pages through `/admin/backup/photos` and `/admin/backup/journals`) |
| [install.sh](install.sh) | Installs it under `/opt/pripri-backup` with a systemd service and 30-minute timer |
| [pripri-backup.service](pripri-backup.service), [pripri-backup.timer](pripri-backup.timer) | The systemd units |
| [pripri-backup.env.example](pripri-backup.env.example) | `/etc/pripri-backup.env`: `API_URL`, `BACKUP_EMAIL`, `BACKUP_PASSWORD`, `BACKUP_DIR` |

## 1. A backup account

A superuser used only by the Pi, so it can be turned off without touching
yours. Invite it from the app (☰ on the trips screen → Invite someone, e.g.
`backup@…`), sign in as it once to choose its password, then make it an
admin: on the Admin page (Role → Admin), or on Fly:

```bash
fly ssh console -C "python -m app.make_admin backup@…"
```

Turn its analytics off on the Admin page too (admins start off; an account
made an admin later keeps what it had).

## 2. The drive

ext4: it stays plugged into the Pi. **Formatting erases it**: check the
device name with `lsblk` first.

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

## 3. Install, and fill in the account

From a clone of this repo on the Pi:

```bash
make pi-backup-install                        # sudo; the timer runs as you
sudo nano /etc/pripri-backup.env              # BACKUP_EMAIL, BACKUP_PASSWORD
make pi-backup-run                            # one run now, and its log
journalctl -u pripri-backup -n 20             # later: "3 new photos (41.2 MB), …"
systemctl list-timers pripri-backup.timer     # when it runs next
```

Run `make pi-backup-install` again after pulling changes to the script.
Photos still waiting on a phone (not uploaded yet) aren't on the server, so
they're backed up once uploaded.

More on a photo's whole life: [docs/photos.md](../../docs/photos.md).
