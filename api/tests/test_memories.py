"""The trip journal: memories by the owner and editors, ordered by the
server's UTC time, editable and deletable only by their author. (Who sees
which memory — viewers and public ones — is tests/test_public_memories.py.)
The `viewer` fixture is added as an editor here, so it can write."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Memory, UserRecord
from app.sample_data import load_sample_trip
from tests.test_sharing import edited_trip


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
    tid = (await edited_trip(client, viewer))["id"]
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


def _parse(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


async def test_without_a_phone_time_the_server_stamps_it(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    before = dt.datetime.now(dt.UTC)
    memory = await _write(client, tid, "now")
    stamped = _parse(memory["createdAt"])
    assert before - dt.timedelta(seconds=1) <= stamped <= dt.datetime.now(dt.UTC)
    assert memory["createdAt"] == memory["receivedAt"]


async def test_the_phones_time_orders_the_journal(client: AsyncClient) -> None:
    """Written offline in this order, uploaded in the other: the journal
    follows when they were written."""
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    url = f"/trips/{tid}/memories"
    late = {
        "id": str(uuid.uuid4()),
        "createdAt": "2026-05-11T20:15:00Z",
        "text": "dessert",
        "zone": "Europe/Zurich",
    }
    early = {
        "id": str(uuid.uuid4()),
        "createdAt": "2026-05-11T20:00:00+02:00",
        "text": "dinner",
        "zone": "Europe/Zurich",
    }
    assert (await client.post(url, json=late)).status_code == 201
    saved = (await client.post(url, json=early)).json()
    # Stored as UTC; the server's own arrival stamp is kept separately.
    assert _parse(saved["createdAt"]) == dt.datetime(2026, 5, 11, 18, 0, tzinfo=dt.UTC)
    assert _parse(saved["receivedAt"]) > _parse(saved["createdAt"])
    assert saved["id"] == early["id"]
    assert [m["text"] for m in (await client.get(url)).json()] == ["dinner", "dessert"]


async def test_a_retry_with_the_same_id_never_duplicates(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    url = f"/trips/{tid}/memories"
    body = {
        "id": str(uuid.uuid4()),
        "createdAt": "2026-05-11T18:00:00Z",
        "text": "once",
        "zone": "UTC",
    }
    first = await client.post(url, json=body)
    again = await client.post(url, json=body)
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()
    assert len((await client.get(url)).json()) == 1


async def test_an_id_that_isnt_yours_to_reuse_is_a_409(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    tid = (await edited_trip(client, viewer))["id"]
    url = f"/trips/{tid}/memories"
    mid = str(uuid.uuid4())
    await client.post(url, json={"id": mid, "text": "the owner's", "zone": "UTC"})
    # Someone else sending the same id.
    assert (await viewer.post(url, json={"id": mid, "text": "x", "zone": "UTC"})).status_code == 409
    # The same id on another trip.
    other = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    assert (
        await client.post(f"/trips/{other}/memories", json={"id": mid, "text": "x", "zone": "UTC"})
    ).status_code == 409
    # A deleted memory's id can't come back.
    await client.delete(f"{url}/{mid}")
    assert (
        await client.post(url, json={"id": mid, "text": "again", "zone": "UTC"})
    ).status_code == 409


async def test_a_phone_time_far_in_the_future_is_clamped(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    url = f"/trips/{tid}/memories"
    now = dt.datetime.now(dt.UTC)
    slightly = (now + dt.timedelta(minutes=5)).isoformat()
    far = (now + dt.timedelta(hours=3)).isoformat()
    ok = (
        await client.post(url, json={"createdAt": slightly, "text": "a bit fast", "zone": "UTC"})
    ).json()
    assert _parse(ok["createdAt"]) == dt.datetime.fromisoformat(slightly)
    clamped = (
        await client.post(url, json={"createdAt": far, "text": "way off", "zone": "UTC"})
    ).json()
    assert clamped["createdAt"] == clamped["receivedAt"]


async def test_a_phone_time_must_be_an_instant(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    resp = await client.post(
        f"/trips/{tid}/memories",
        json={"createdAt": "2026-05-11T20:00:00", "text": "no offset", "zone": "UTC"},
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
    tid = (await edited_trip(client, viewer))["id"]
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
    tid = (await edited_trip(client, viewer))["id"]
    await _write(viewer, tid, "mine")
    await client.delete(f"/trips/{tid}/members/{viewer_user.id}")
    assert (await viewer.get(f"/trips/{tid}/memories")).status_code == 404
    # The owner still has the whole journal, the removed viewer's memory included.
    assert [m["text"] for m in (await client.get(f"/trips/{tid}/memories")).json()] == ["mine"]
    await client.delete(f"/trips/{tid}")
    assert (await client.get(f"/trips/{tid}/memories")).status_code == 404


async def test_a_memory_can_carry_where_it_was_written(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    url = f"/trips/{tid}/memories"
    here = {"lat": 46.9479, "lng": 7.4474, "accuracy": 12.5}
    saved = (
        await client.post(
            url, json={"text": "Zytglogge chimes", "zone": "Europe/Zurich", "location": here}
        )
    ).json()
    # Read back with room for what's there (no lookup here: no Google key).
    named = {**here, "placeName": None, "placeArea": None}
    assert saved["location"] == named
    plain = (await client.post(url, json={"text": "no place", "zone": "UTC"})).json()
    assert plain["location"] is None
    listed = {m["text"]: m["location"] for m in (await client.get(url)).json()}
    assert listed == {"Zytglogge chimes": named, "no place": None}


async def test_a_location_must_be_a_real_place(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    url = f"/trips/{tid}/memories"
    for bad in (
        {"lat": 91, "lng": 0},
        {"lat": 0, "lng": 181},
        {"lat": 10},  # a latitude needs its longitude
        {"lat": 0, "lng": 0, "accuracy": -1},
        {"lat": 0, "lng": 0, "altitude": 3},
    ):
        resp = await client.post(url, json={"text": "x", "zone": "UTC", "location": bad})
        assert resp.status_code == 422, bad


async def test_an_edit_keeps_or_drops_the_location_but_never_adds_one(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    url = f"/trips/{tid}/memories"
    here = {"lat": 46.9479, "lng": 7.4474, "accuracy": None}
    m = (await client.post(url, json={"text": "a", "zone": "UTC", "location": here})).json()
    kept = (await client.put(f"{url}/{m['id']}", json={"text": "b"})).json()
    assert kept["location"] == {**here, "placeName": None, "placeArea": None}
    dropped = (await client.put(f"{url}/{m['id']}", json={"text": "c", "location": None})).json()
    assert dropped["location"] is None
    # Setting one on an edit is ignored: it's where the memory was written.
    again = (await client.put(f"{url}/{m['id']}", json={"text": "d", "location": here})).json()
    assert again["location"] is None
