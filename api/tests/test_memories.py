"""The trip journal: memories by everyone on a trip, ordered by the server's
UTC time, editable and deletable only by their author."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Memory, UserRecord
from app.sample_data import load_sample_trip
from tests.test_sharing import shared_trip


async def _write(
    client: AsyncClient, trip_id: str, text: str, zone: str = "Europe/Zurich"
) -> dict[str, Any]:
    resp = await client.post(f"/trips/{trip_id}/memories", json={"text": text, "zone": zone})
    assert resp.status_code == 201, resp.text
    body: dict[str, Any] = resp.json()
    return body


async def test_everyone_on_the_trip_writes_and_reads_the_same_journal(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    tid = (await shared_trip(client, viewer))["id"]
    first = await _write(client, tid, "Fondue at Kornhauskeller", "Europe/Zurich")
    second = await _write(viewer, tid, "The joke about the cable car", "Asia/Tokyo")

    assert first["authorEmail"] == "user@example.com"
    assert first["zone"] == "Europe/Zurich"
    assert first["createdAt"].endswith("Z") or "+00:00" in first["createdAt"]

    as_owner = (await client.get(f"/trips/{tid}/memories")).json()
    as_viewer = (await viewer.get(f"/trips/{tid}/memories")).json()
    assert [m["id"] for m in as_owner] == [first["id"], second["id"]]
    assert [m["id"] for m in as_viewer] == [first["id"], second["id"]]
    # `mine` is from the caller's point of view.
    assert [m["mine"] for m in as_owner] == [True, False]
    assert [m["mine"] for m in as_viewer] == [False, True]


async def test_order_is_the_utc_instant_not_the_local_clock(
    client: AsyncClient, db: AsyncSession, test_user: UserRecord
) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    trip_id = uuid.UUID(tid)
    base = dt.datetime(2026, 5, 11, 12, 0, tzinfo=dt.UTC)
    # Written in Chicago at 07:00 local (12:00Z), then in Tokyo one second
    # later (21:00:01 local). Order follows the instant, not either local
    # clock or zone.
    rows = [
        Memory(
            trip_id=trip_id,
            user_id=test_user.id,
            text="later",
            zone="Asia/Tokyo",
            created_at=base + dt.timedelta(seconds=1),
        ),
        Memory(
            trip_id=trip_id,
            user_id=test_user.id,
            text="earlier",
            zone="America/Chicago",
            created_at=base,
        ),
        # Same instant as "earlier": the id breaks the tie, so the order is stable.
        Memory(
            id=uuid.UUID(int=0),
            trip_id=trip_id,
            user_id=test_user.id,
            text="tie, smallest id",
            zone="Europe/Zurich",
            created_at=base,
        ),
    ]
    db.add_all(rows)
    await db.commit()
    texts = [m["text"] for m in (await client.get(f"/trips/{tid}/memories")).json()]
    assert texts == ["tie, smallest id", "earlier", "later"]


async def test_the_server_stamps_the_time_and_a_client_cannot_backdate(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    before = dt.datetime.now(dt.UTC)
    memory = await _write(client, tid, "now")
    stamped = dt.datetime.fromisoformat(memory["createdAt"].replace("Z", "+00:00"))
    assert before - dt.timedelta(seconds=1) <= stamped <= dt.datetime.now(dt.UTC)
    resp = await client.post(
        f"/trips/{tid}/memories",
        json={"text": "backdated", "zone": "UTC", "createdAt": "2020-01-01T00:00:00Z"},
    )
    assert resp.status_code == 422


async def test_editing_keeps_its_place_and_marks_it_edited(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    first = await _write(client, tid, "first")
    await _write(client, tid, "second")
    resp = await client.put(
        f"/trips/{tid}/memories/{first['id']}", json={"text": "  first, edited  "}
    )
    assert resp.status_code == 200
    edited = resp.json()
    assert edited["text"] == "first, edited"
    assert edited["createdAt"] == first["createdAt"]
    assert edited["zone"] == first["zone"]
    assert edited["updatedAt"] is not None
    texts = [m["text"] for m in (await client.get(f"/trips/{tid}/memories")).json()]
    assert texts == ["first, edited", "second"]


async def test_only_the_author_edits_or_deletes(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = (await shared_trip(client, viewer))["id"]
    owners = await _write(client, tid, "the owner's")
    viewers = await _write(viewer, tid, "the viewer's")

    # Someone else on the trip: 403. Someone not on it: 404.
    assert (
        await viewer.put(f"/trips/{tid}/memories/{owners['id']}", json={"text": "x"})
    ).status_code == 403
    assert (await viewer.delete(f"/trips/{tid}/memories/{owners['id']}")).status_code == 403
    assert (await client.delete(f"/trips/{tid}/memories/{viewers['id']}")).status_code == 403
    assert (await stranger.get(f"/trips/{tid}/memories")).status_code == 404
    assert (
        await stranger.post(f"/trips/{tid}/memories", json={"text": "x", "zone": "UTC"})
    ).status_code == 404
    assert (await stranger.delete(f"/trips/{tid}/memories/{owners['id']}")).status_code == 404

    # The author can.
    assert (await viewer.delete(f"/trips/{tid}/memories/{viewers['id']}")).status_code == 204
    texts = [m["text"] for m in (await client.get(f"/trips/{tid}/memories")).json()]
    assert texts == ["the owner's"]
    # Gone is gone.
    assert (await viewer.delete(f"/trips/{tid}/memories/{viewers['id']}")).status_code == 404


async def test_text_and_zone_are_checked(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    url = f"/trips/{tid}/memories"
    assert (await client.post(url, json={"text": "   ", "zone": "UTC"})).status_code == 422
    assert (await client.post(url, json={"text": "x" * 2001, "zone": "UTC"})).status_code == 422
    assert (await client.post(url, json={"text": "x" * 2000, "zone": "UTC"})).status_code == 201
    assert (await client.post(url, json={"text": "ok", "zone": "Mars/Olympus"})).status_code == 422
    assert (await client.post(url, json={"text": "ok", "zone": "+09:00"})).status_code == 422
    assert (await client.post(url, json={"text": "ok"})).status_code == 422


async def test_losing_access_to_the_trip_loses_its_journal(
    client: AsyncClient, viewer: AsyncClient, viewer_user: UserRecord
) -> None:
    tid = (await shared_trip(client, viewer))["id"]
    await _write(viewer, tid, "mine")
    await client.delete(f"/trips/{tid}/members/{viewer_user.id}")
    assert (await viewer.get(f"/trips/{tid}/memories")).status_code == 404
    # The owner still has the whole journal, the removed viewer's memory included.
    assert [m["text"] for m in (await client.get(f"/trips/{tid}/memories")).json()] == ["mine"]
    await client.delete(f"/trips/{tid}")
    assert (await client.get(f"/trips/{tid}/memories")).status_code == 404
