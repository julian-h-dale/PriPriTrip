"""What the Pi backs up (Phase 48): every live photo, paged by a cursor that
never skips or repeats, and every trip's journal. Superuser only."""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.sample_data import load_sample_trip
from app.services import backup as backup_service
from app.settings import get_app_settings
from tests.test_photos import _upload, jpeg

ZERO = "00000000-0000-0000-0000-000000000000"


@pytest.fixture(autouse=True)
def photo_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "photos"
    monkeypatch.setattr(get_app_settings(), "photo_dir", str(root))
    return root


async def _memory(client: AsyncClient, tid: str, text: str, **extra: Any) -> dict[str, Any]:
    resp = await client.post(
        f"/trips/{tid}/memories", json={"text": text, "zone": "Asia/Tokyo", **extra}
    )
    assert resp.status_code == 201, resp.text
    body: dict[str, Any] = resp.json()
    return body


async def _photo(client: AsyncClient, tid: str, mid: str) -> str:
    resp = await _upload(client, tid, mid, jpeg(64, 48))
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def _all_pages(admin: AsyncClient, after: str | None = None) -> list[dict[str, Any]]:
    photos: list[dict[str, Any]] = []
    while True:
        params = {"after": after} if after else {}
        page = (await admin.get("/admin/backup/photos", params=params)).json()
        photos += page["photos"]
        after = page["next"]
        if after is None:
            return photos


async def test_only_a_superuser_can_back_up(
    token_client: AsyncClient, anon_client: AsyncClient, admin_client: AsyncClient
) -> None:
    for path in ("/admin/backup/photos", "/admin/backup/journals"):
        assert (await anon_client.get(path)).status_code == 401
        assert (await token_client.get(path)).status_code == 403
        assert (await admin_client.get(path)).status_code == 200


async def test_lists_every_live_photo_with_where_it_goes(
    client: AsyncClient, admin_client: AsyncClient
) -> None:
    tid = await client.post("/trips/import", json=load_sample_trip())
    tid = tid.json()["id"]
    memory = await _memory(
        client, tid, "sunset", createdAt="2026-05-11T09:05:00Z"
    )  # 18:05 in Tokyo
    pid = await _photo(client, tid, memory["id"])

    page = (await admin_client.get("/admin/backup/photos")).json()
    assert page["next"] is None
    [photo] = page["photos"]
    assert photo["id"] == pid
    assert photo["tripId"] == tid
    assert photo["tripName"] == load_sample_trip()["name"]
    assert photo["memoryId"] == memory["id"]
    assert photo["author"] == "Test User"
    assert photo["localDate"] == "2026-05-11"
    assert photo["localTime"] == "1805"
    assert photo["format"] == "jpeg"
    assert photo["bytes"] > 0
    assert photo["originalUrl"] == f"/photos/{pid}/original"
    # The URL serves the original.
    assert (await admin_client.get(photo["originalUrl"])).status_code == 200


async def test_pages_are_complete_and_never_repeat(
    client: AsyncClient, admin_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = backup_service.photo_page

    async def small_pages(db: Any, after: str | None = None, limit: int = 2) -> Any:
        return await original(db, after, limit)

    monkeypatch.setattr(backup_service, "photo_page", small_pages)

    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid, "lots of photos")
    ids = [await _photo(client, tid, memory["id"]) for _ in range(5)]

    first = (await admin_client.get("/admin/backup/photos")).json()
    assert len(first["photos"]) == 2 and first["next"]
    # One more arrives between pages: it's still picked up, once.
    ids.append(await _photo(client, tid, memory["id"]))
    rest = await _all_pages(admin_client, first["next"])
    got = [p["id"] for p in first["photos"] + rest]
    assert sorted(got) == sorted(ids)
    assert len(got) == len(set(got))


async def test_asking_from_a_time_with_the_zero_id_overlaps_safely(
    client: AsyncClient, admin_client: AsyncClient
) -> None:
    """How the Pi re-asks: from an hour before its last photo."""
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid, "x")
    pid = await _photo(client, tid, memory["id"])
    hour_ago = (dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)).isoformat()
    later = (dt.datetime.now(dt.UTC) + dt.timedelta(hours=1)).isoformat()
    assert [p["id"] for p in await _all_pages(admin_client, f"{hour_ago}|{ZERO}")] == [pid]
    assert await _all_pages(admin_client, f"{later}|{ZERO}") == []
    for bad in ("nonsense", f"2026-10-30T00:00:00|{ZERO}", "2026-10-30T00:00:00Z|nope"):
        resp = await admin_client.get("/admin/backup/photos", params={"after": bad})
        assert resp.status_code == 422, bad


async def test_deleted_photos_memories_and_trips_are_left_out(
    client: AsyncClient, admin_client: AsyncClient
) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    keep = await _memory(client, tid, "keep")
    kept = await _photo(client, tid, keep["id"])
    gone_photo = await _photo(client, tid, keep["id"])
    await client.delete(f"/trips/{tid}/memories/{keep['id']}/photos/{gone_photo}")
    gone_memory = await _memory(client, tid, "gone")
    await _photo(client, tid, gone_memory["id"])
    await client.delete(f"/trips/{tid}/memories/{gone_memory['id']}")
    other = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    other_memory = await _memory(client, other, "other trip")
    await _photo(client, other, other_memory["id"])
    await client.delete(f"/trips/{other}")

    assert [p["id"] for p in await _all_pages(admin_client)] == [kept]


async def test_journals_hold_every_memory_public_or_not(
    client: AsyncClient, admin_client: AsyncClient
) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    private = await _memory(client, tid, "just us", createdAt="2026-05-11T01:00:00Z")
    public = await _memory(
        client,
        tid,
        "for everyone",
        createdAt="2026-05-11T02:00:00Z",
        isPublic=True,
        location={"lat": 26.2, "lng": 127.7, "accuracy": 10},
    )
    pid = await _photo(client, tid, public["id"])
    deleted = await _memory(client, tid, "deleted")
    await client.delete(f"/trips/{tid}/memories/{deleted['id']}")
    await client.post("/trips/import", json=load_sample_trip())  # no journal: not listed

    [journal] = (await admin_client.get("/admin/backup/journals")).json()
    assert journal["tripId"] == tid
    assert journal["startDate"] == load_sample_trip()["startDate"]
    assert [(m["id"], m["text"], m["isPublic"]) for m in journal["memories"]] == [
        (private["id"], "just us", False),
        (public["id"], "for everyone", True),
    ]
    assert journal["memories"][1]["photoIds"] == [pid]
    assert journal["memories"][1]["location"]["lat"] == 26.2
    assert journal["memories"][0]["author"] == "Test User"
