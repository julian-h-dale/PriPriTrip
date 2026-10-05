"""The Pi's backup script (scripts/pi-backup/pripri_backup.py), against a fake
server: it refuses without the drive, resumes, never keeps a short download,
skips what it has, and never deletes."""

from __future__ import annotations

import datetime as dt
import importlib.util
import io
import json
import sys
import threading
import urllib.parse
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "pi-backup" / "pripri_backup.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("pripri_backup", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["pripri_backup"] = module
    spec.loader.exec_module(module)
    return module


pb = _load()


def _photo(n: int, data: bytes, **extra: Any) -> dict[str, Any]:
    pid = f"{n:08d}-0000-0000-0000-000000000000"
    return {
        "id": pid,
        "tripId": "11111111-0000-0000-0000-000000000000",
        "tripName": "Okinawa & Taipei",
        "memoryId": "m",
        "author": "Julian",
        "localDate": "2026-10-30",
        "localTime": f"18{n:02d}",
        "format": "jpeg",
        "bytes": len(data),
        "uploadedAt": f"2026-10-30T09:{n:02d}:00Z",
        "originalUrl": f"/photos/{pid}/original",
        **extra,
    }


class FakeServer:
    """Serves /auth/login, /admin/backup/*, and photo originals."""

    def __init__(self) -> None:
        self.photos: list[tuple[dict[str, Any], bytes]] = []
        self.journals: list[dict[str, Any]] = []
        self.page_size = 2
        self.afters: list[str | None] = []
        self.short: set[str] = set()  # photo ids served truncated
        self.password = "secret"

    def handler(self) -> type[BaseHTTPRequestHandler]:
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def _send(self, status: int, body: bytes, kind: str = "application/json") -> None:
                self.send_response(status)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                form = urllib.parse.parse_qs(
                    self.rfile.read(int(self.headers["Content-Length"])).decode()
                )
                if form.get("password") == [server.password]:
                    self._send(200, json.dumps({"access_token": "tok"}).encode())
                else:
                    self._send(400, b'{"detail":"LOGIN_BAD_CREDENTIALS"}')

            def do_GET(self) -> None:
                url = urllib.parse.urlparse(self.path)
                if url.path.startswith("/admin/"):
                    if self.headers.get("Authorization") != "Bearer tok":
                        self._send(401, b"{}")
                        return
                if url.path == "/admin/backup/photos":
                    after = urllib.parse.parse_qs(url.query).get("after", [None])[0]
                    server.afters.append(after)
                    rows = [p for p, _ in server.photos]
                    if after:
                        at_text, pid = after.split("|")
                        at = dt.datetime.fromisoformat(at_text)
                        rows = [
                            p
                            for p in rows
                            if (dt.datetime.fromisoformat(p["uploadedAt"]), p["id"]) > (at, pid)
                        ]
                    page = rows[: server.page_size]
                    more = len(rows) > server.page_size
                    nxt = f"{page[-1]['uploadedAt']}|{page[-1]['id']}" if more else None
                    self._send(200, json.dumps({"photos": page, "next": nxt}).encode())
                elif url.path == "/admin/backup/journals":
                    self._send(200, json.dumps(server.journals).encode())
                elif url.path.startswith("/photos/"):
                    pid = url.path.split("/")[2]
                    for photo, data in server.photos:
                        if photo["id"] == pid:
                            self._send(
                                200, data[:-1] if pid in server.short else data, "image/jpeg"
                            )
                            return
                    self._send(404, b"{}")
                else:
                    self._send(404, b"{}")

        return Handler


@pytest.fixture
def server() -> Iterator[tuple[FakeServer, str]]:
    fake = FakeServer()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), fake.handler())
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield fake, f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def _settings(url: str, drive: Path, **extra: Any) -> Any:
    return pb.Settings(
        api_url=url,
        email="backup@example.com",
        password=extra.pop("password", "secret"),
        backup_dir=drive,
        require_mount=extra.pop("require_mount", False),
    )


def _files(drive: Path) -> list[str]:
    return sorted(
        str(p.relative_to(drive / "PriPriTrip"))
        for p in drive.rglob("*")
        if p.is_file() and p.name != "state.json"
    )


def test_refuses_when_the_drive_isnt_mounted(server: Any, tmp_path: Path) -> None:
    _, url = server
    with pytest.raises(pb.BackupError, match="isn't mounted"):
        pb.run(_settings(url, tmp_path / "drive", require_mount=True), io.StringIO())
    assert not (tmp_path / "drive").exists()


def test_settings_need_the_account() -> None:
    with pytest.raises(pb.BackupError, match="BACKUP_EMAIL, BACKUP_PASSWORD"):
        pb.Settings.from_env({"API_URL": "http://x"})
    settings = pb.Settings.from_env(
        {"API_URL": "http://x/api/", "BACKUP_EMAIL": "a", "BACKUP_PASSWORD": "b"}
    )
    assert settings.api_url == "http://x/api"
    assert str(settings.backup_dir) == "/mnt/pripri-backup"
    assert settings.require_mount


def test_a_wrong_password_says_so(server: Any, tmp_path: Path) -> None:
    _, url = server
    with pytest.raises(pb.BackupError, match="Sign-in refused"):
        pb.run(_settings(url, tmp_path, password="nope"), io.StringIO())


def test_downloads_every_photo_into_dated_folders_with_the_journal(
    server: Any, tmp_path: Path
) -> None:
    fake, url = server
    fake.photos = [(_photo(n, f"photo {n}".encode()), f"photo {n}".encode()) for n in range(1, 6)]
    fake.journals = [
        {"tripId": fake.photos[0][0]["tripId"], "tripName": "Okinawa & Taipei", "memories": []}
    ]
    out = io.StringIO()
    summary = pb.run(_settings(url, tmp_path), out)

    assert summary.new == 5 and not summary.failed
    assert _files(tmp_path) == [
        "okinawa-taipei/2026-10-30/1801_julian_00000001.jpg",
        "okinawa-taipei/2026-10-30/1802_julian_00000002.jpg",
        "okinawa-taipei/2026-10-30/1803_julian_00000003.jpg",
        "okinawa-taipei/2026-10-30/1804_julian_00000004.jpg",
        "okinawa-taipei/2026-10-30/1805_julian_00000005.jpg",
        "okinawa-taipei/journal.json",
    ]
    photo = tmp_path / "PriPriTrip/okinawa-taipei/2026-10-30/1803_julian_00000003.jpg"
    assert photo.read_bytes() == b"photo 3"
    assert "5 new photos" in out.getvalue()
    state = json.loads((tmp_path / "PriPriTrip/state.json").read_text())
    assert state["lastUploadedAt"] == "2026-10-30T09:05:00Z"


def test_resumes_from_before_the_last_photo_and_skips_what_it_has(
    server: Any, tmp_path: Path
) -> None:
    fake, url = server
    fake.photos = [(_photo(1, b"one"), b"one")]
    pb.run(_settings(url, tmp_path), io.StringIO())
    fake.photos.append((_photo(2, b"two"), b"two"))
    fake.afters.clear()

    summary = pb.run(_settings(url, tmp_path), io.StringIO())
    # It asked from an hour before the last photo it saw (the zero id).
    assert fake.afters[0] == f"2026-10-30T08:01:00+00:00|{pb.ZERO_ID}"
    assert (summary.new, summary.skipped) == (1, 1)


def test_a_short_download_never_becomes_a_photo_and_is_retried(server: Any, tmp_path: Path) -> None:
    fake, url = server
    fake.photos = [(_photo(1, b"good"), b"good"), (_photo(2, b"truncated"), b"truncated")]
    fake.short = {fake.photos[1][0]["id"]}
    out = io.StringIO()
    summary = pb.run(_settings(url, tmp_path), out)
    assert summary.failed == [fake.photos[1][0]["id"]]
    assert "expected 9" in out.getvalue()
    names = _files(tmp_path)
    assert len(names) == 1 and names[0].endswith("_00000001.jpg")
    assert not list(tmp_path.rglob("*.part"))
    # The starting point didn't move on, so the next run tries it again.
    assert "lastUploadedAt" not in json.loads((tmp_path / "PriPriTrip/state.json").read_text())
    fake.short = set()
    assert pb.run(_settings(url, tmp_path), io.StringIO()).new == 1


def test_a_photo_deleted_in_the_app_stays_on_the_drive(server: Any, tmp_path: Path) -> None:
    fake, url = server
    fake.photos = [(_photo(1, b"one"), b"one"), (_photo(2, b"two"), b"two")]
    pb.run(_settings(url, tmp_path), io.StringIO())
    fake.photos.pop(0)  # deleted in the app: no longer listed
    pb.run(_settings(url, tmp_path), io.StringIO())
    assert len([n for n in _files(tmp_path) if n.endswith(".jpg")]) == 2


def test_two_trips_with_one_name_get_their_own_folders(server: Any, tmp_path: Path) -> None:
    fake, url = server
    other = _photo(2, b"two", tripId="22222222-0000-0000-0000-000000000000")
    fake.photos = [(_photo(1, b"one"), b"one"), (other, b"two")]
    pb.run(_settings(url, tmp_path), io.StringIO())
    folders = {n.split("/")[0] for n in _files(tmp_path)}
    assert folders == {"okinawa-taipei", "okinawa-taipei-22222222"}


def test_the_journal_is_rewritten_only_when_it_changes(server: Any, tmp_path: Path) -> None:
    fake, url = server
    journal = {"tripId": "t1", "tripName": "Okinawa", "memories": [{"text": "a"}]}
    fake.journals = [journal]
    assert pb.run(_settings(url, tmp_path), io.StringIO()).journals == 1
    assert pb.run(_settings(url, tmp_path), io.StringIO()).journals == 0
    journal["memories"].append({"text": "b"})
    assert pb.run(_settings(url, tmp_path), io.StringIO()).journals == 1
    saved = json.loads((tmp_path / "PriPriTrip/okinawa/journal.json").read_text())
    assert [m["text"] for m in saved["memories"]] == ["a", "b"]
