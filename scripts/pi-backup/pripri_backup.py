#!/usr/bin/env python3
"""Back up PriPriTrip's journal photos (originals) and journals to a drive.

Runs on the Raspberry Pi every 30 minutes (pripri-backup.timer). Python 3
standard library only, so there's nothing to install.

Each run:
1. refuses to start unless the backup drive is mounted (otherwise it would
   quietly fill the SD card);
2. signs in as the backup account (a superuser);
3. pages through /admin/backup/photos from a little before where the last
   run got to, downloading each original it doesn't already have — to a
   `.part` file, size-checked, then renamed, so a crash never leaves a half
   photo under a real name;
4. rewrites each trip's journal.json when it changed;
5. prints a one-line summary (journalctl -u pripri-backup).

Nothing is ever deleted from the drive: a photo deleted in the app stays in
the backup.

Layout (under BACKUP_DIR/PriPriTrip/):
    <trip>/<YYYY-MM-DD>/<HHMM>_<author>_<photo id, 8 chars>.<ext>
    <trip>/journal.json
    state.json

Settings come from the environment (/etc/pripri-backup.env under systemd):
    API_URL          e.g. https://pripri-trip.fly.dev/api
    BACKUP_EMAIL     the backup account
    BACKUP_PASSWORD
    BACKUP_DIR       the drive's mount point (default /mnt/pripri-backup)
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ZERO_ID = "00000000-0000-0000-0000-000000000000"
# Re-ask from this long before the last photo seen, so a photo that committed
# out of order is still picked up (files already on the drive are skipped).
OVERLAP = dt.timedelta(hours=1)
TIMEOUT = 60  # seconds per request
CHUNK = 1 << 20
EXTENSIONS = {"jpeg": "jpg", "png": "png", "webp": "webp", "heic": "heic"}


class BackupError(Exception):
    """Stops the run with a clear message (and a failed systemd unit)."""


@dataclass
class Settings:
    api_url: str
    email: str
    password: str
    backup_dir: Path
    require_mount: bool = True

    @classmethod
    def from_env(cls, env: dict[str, str]) -> Settings:
        missing = [k for k in ("API_URL", "BACKUP_EMAIL", "BACKUP_PASSWORD") if not env.get(k)]
        if missing:
            raise BackupError(f"Set {', '.join(missing)} (in /etc/pripri-backup.env)")
        return cls(
            api_url=env["API_URL"].rstrip("/"),
            email=env["BACKUP_EMAIL"],
            password=env["BACKUP_PASSWORD"],
            backup_dir=Path(env.get("BACKUP_DIR") or "/mnt/pripri-backup"),
            require_mount=env.get("BACKUP_REQUIRE_MOUNT", "1") != "0",
        )


@dataclass
class Summary:
    new: int = 0
    new_bytes: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)
    journals: int = 0

    def line(self) -> str:
        mb = self.new_bytes / 1_000_000
        parts = [f"{self.new} new photo{'s' if self.new != 1 else ''} ({mb:.1f} MB)"]
        parts.append(f"{self.skipped} already backed up")
        if self.journals:
            parts.append(f"{self.journals} journal{'s' if self.journals != 1 else ''} updated")
        if self.failed:
            parts.append(f"{len(self.failed)} failed")
        return ", ".join(parts)


def slug(text: str, fallback: str = "x") -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or fallback


# ---- HTTP ----


def _open(request: urllib.request.Request | str) -> Any:
    try:
        return urllib.request.urlopen(request, timeout=TIMEOUT)
    except urllib.error.HTTPError as exc:
        raise BackupError(f"{exc.code} from {exc.url}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise BackupError(f"Can't reach the server: {exc}") from None


def login(settings: Settings) -> str:
    body = urllib.parse.urlencode({"username": settings.email, "password": settings.password})
    request = urllib.request.Request(
        f"{settings.api_url}/auth/login",
        data=body.encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with _open(request) as resp:
            return str(json.load(resp)["access_token"])
    except BackupError as exc:
        if str(exc).startswith("400"):
            raise BackupError("Sign-in refused: check BACKUP_EMAIL and BACKUP_PASSWORD") from None
        raise


def get_json(
    settings: Settings, token: str, path: str, params: dict[str, str] | None = None
) -> Any:
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    request = urllib.request.Request(
        f"{settings.api_url}{path}{query}", headers={"Authorization": f"Bearer {token}"}
    )
    with _open(request) as resp:
        return json.load(resp)


def download(settings: Settings, url_path: str, target: Path, expected: int) -> None:
    """Fetch to `<target>.part`, check the size, then rename into place."""
    part = target.with_name(target.name + ".part")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with _open(f"{settings.api_url}{url_path}") as resp, open(part, "wb") as out:
            while chunk := resp.read(CHUNK):
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        size = part.stat().st_size
        if size != expected:
            raise BackupError(f"got {size} bytes, expected {expected}")
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)


# ---- state ----


def load_state(root: Path) -> dict[str, Any]:
    try:
        data = json.loads((root / "state.json").read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(root: Path, state: dict[str, Any]) -> None:
    write_if_changed(root / "state.json", json.dumps(state, indent=2, sort_keys=True) + "\n")


def write_if_changed(path: Path, text: str) -> bool:
    try:
        if path.read_text() == text:
            return False
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text)
    os.replace(tmp, path)
    return True


def trip_dir(state: dict[str, Any], trip_id: str, trip_name: str) -> str:
    """The trip's folder, fixed the first time it's seen. Two trips with the
    same name get the second one's id on the end."""
    dirs: dict[str, str] = state.setdefault("tripDirs", {})
    if trip_id not in dirs:
        name = slug(trip_name, "trip")
        if name in dirs.values():
            name = f"{name}-{trip_id[:8]}"
        dirs[trip_id] = name
    return dirs[trip_id]


def photo_path(root: Path, state: dict[str, Any], photo: dict[str, Any]) -> Path:
    folder = root / trip_dir(state, photo["tripId"], photo["tripName"]) / photo["localDate"]
    ext = EXTENSIONS.get(photo["format"], photo["format"])
    name = f"{photo['localTime']}_{slug(photo['author'], 'someone')}_{photo['id'][:8]}.{ext}"
    return folder / name


# ---- the run ----


def run(settings: Settings, out: Any = sys.stdout) -> Summary:
    if settings.require_mount and not os.path.ismount(settings.backup_dir):
        raise BackupError(
            f"{settings.backup_dir} isn't mounted — is the drive plugged in? Not backing up to the SD card."
        )
    root = settings.backup_dir / "PriPriTrip"
    root.mkdir(parents=True, exist_ok=True)
    state = load_state(root)
    token = login(settings)
    summary = Summary()

    after = None
    if state.get("lastUploadedAt"):
        start = dt.datetime.fromisoformat(state["lastUploadedAt"]) - OVERLAP
        after = f"{start.isoformat()}|{ZERO_ID}"
    latest: str | None = state.get("lastUploadedAt")
    while True:
        page = get_json(
            settings, token, "/admin/backup/photos", {"after": after} if after else None
        )
        for photo in page["photos"]:
            target = photo_path(root, state, photo)
            if target.exists() and target.stat().st_size == photo["bytes"]:
                summary.skipped += 1
            else:
                try:
                    download(settings, photo["originalUrl"], target, photo["bytes"])
                    summary.new += 1
                    summary.new_bytes += photo["bytes"]
                except (BackupError, OSError) as exc:
                    summary.failed.append(photo["id"])
                    print(f"photo {photo['id']}: {exc}", file=out)
            if latest is None or photo["uploadedAt"] > latest:
                latest = photo["uploadedAt"]
        after = page["next"]
        if after is None:
            break

    for journal in get_json(settings, token, "/admin/backup/journals"):
        folder = root / trip_dir(state, journal["tripId"], journal["tripName"])
        text = json.dumps(journal, indent=2, ensure_ascii=False) + "\n"
        if write_if_changed(folder / "journal.json", text):
            summary.journals += 1

    # Only move the starting point on when every photo made it, so a failed
    # one is tried again next run.
    if not summary.failed and latest:
        state["lastUploadedAt"] = latest
    state["lastRun"] = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    save_state(root, state)
    print(summary.line(), file=out)
    return summary


def main() -> int:
    try:
        summary = run(Settings.from_env(dict(os.environ)))
    except BackupError as exc:
        print(f"pripri-backup: {exc}", file=sys.stderr)
        return 1
    return 1 if summary.failed else 0


if __name__ == "__main__":
    sys.exit(main())
