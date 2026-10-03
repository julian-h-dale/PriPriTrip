"""Sharing a trip: the owner edits; viewers (members) read; strangers see nothing."""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.main import create_app
from app.models import UserRecord
from app.sample_data import load_sample_trip
from app.users import current_active_user


async def _user(db: AsyncSession, email: str) -> UserRecord:
    user = UserRecord(id=uuid.uuid4(), email=email, hashed_password="x", is_active=True)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _client_for(db: AsyncSession, user: UserRecord) -> AsyncClient:
    app = create_app()

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_active_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def viewer_user(db: AsyncSession) -> UserRecord:
    return await _user(db, "pripri@example.com")


@pytest_asyncio.fixture
async def viewer(db: AsyncSession, viewer_user: UserRecord) -> AsyncGenerator[AsyncClient, None]:
    async with await _client_for(db, viewer_user) as ac:
        yield ac


@pytest_asyncio.fixture
async def stranger(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async with await _client_for(db, await _user(db, "stranger@example.com")) as ac:
        yield ac


async def _shared_trip(owner: AsyncClient, viewer: AsyncClient) -> dict[str, Any]:
    trip = (await owner.post("/trips/import", json=load_sample_trip())).json()
    resp = await viewer.post("/trips/join", json={"tripId": trip["id"]})
    assert resp.status_code == 200, resp.text
    return trip


# ---- joining ----


async def test_joining_by_trip_id_makes_a_viewer(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    resp = await viewer.post("/trips/join", json={"tripId": trip["id"]})
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"
    assert resp.json()["stayCount"] == trip["stayCount"]

    listed = (await viewer.get("/trips")).json()
    assert [(t["id"], t["role"]) for t in listed] == [(trip["id"], "viewer")]
    assert (await viewer.get(f"/trips/{trip['id']}")).json()["role"] == "viewer"
    # The owner's own view is unchanged.
    assert (await client.get(f"/trips/{trip['id']}")).json()["role"] == "owner"
    assert [t["role"] for t in (await client.get("/trips")).json()] == ["owner"]


async def test_joining_twice_changes_nothing(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await _shared_trip(client, viewer)
    assert (await viewer.post("/trips/join", json={"tripId": trip["id"]})).status_code == 200
    assert len((await client.get(f"/trips/{trip['id']}/members")).json()) == 1


async def test_joining_an_unknown_or_deleted_trip_is_a_404(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    assert (await viewer.post("/trips/join", json={"tripId": str(uuid.uuid4())})).status_code == 404
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    await client.delete(f"/trips/{trip['id']}")
    assert (await viewer.post("/trips/join", json={"tripId": trip["id"]})).status_code == 404


async def test_the_owner_cannot_join_their_own_trip(client: AsyncClient) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    assert (await client.post("/trips/join", json={"tripId": trip["id"]})).status_code == 409


async def test_a_malformed_id_is_rejected(viewer: AsyncClient) -> None:
    assert (await viewer.post("/trips/join", json={"tripId": "not-a-uuid"})).status_code == 422


# ---- what a viewer may do ----


async def test_a_viewer_can_read_but_every_edit_is_403(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await _shared_trip(client, viewer)
    tid = trip["id"]
    full = (await client.get(f"/trips/{tid}")).json()
    item_id = next(i["id"] for d in full["days"] for i in d["items"])
    stay = full["stays"][0]
    travel = full["travels"][0]

    edits = [
        ("post", f"/trips/{tid}/items", {"date": "2026-05-10", "title": "Pack"}),
        ("put", f"/trips/{tid}/items/{item_id}", {"date": "2026-05-10", "title": "x"}),
        ("delete", f"/trips/{tid}/items/{item_id}", None),
        ("post", f"/trips/{tid}/items/{item_id}/move", {"direction": "up"}),
        ("put", f"/trips/{tid}/days/2026-05-10", {"title": "x"}),
        ("post", f"/trips/{tid}/stays", stay),
        ("put", f"/trips/{tid}/stays/{stay['id']}", stay),
        ("delete", f"/trips/{tid}/stays/{stay['id']}", None),
        ("post", f"/trips/{tid}/travels", travel),
        ("put", f"/trips/{tid}/travels/{travel['id']}", travel),
        ("delete", f"/trips/{tid}/travels/{travel['id']}", None),
        ("delete", f"/trips/{tid}", None),
        ("get", f"/trips/{tid}/members", None),
    ]
    for method, url, body in edits:
        kwargs = {"json": body} if body is not None else {}
        resp = await getattr(viewer, method)(url, **kwargs)
        assert resp.status_code == 403, (method, url, resp.status_code)

    # Nothing changed.
    assert (await client.get(f"/trips/{tid}")).json() == full


async def test_a_stranger_gets_404_everywhere(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    trip = await _shared_trip(client, viewer)
    tid = trip["id"]
    assert (await stranger.get(f"/trips/{tid}")).status_code == 404
    assert (await stranger.delete(f"/trips/{tid}")).status_code == 404
    assert (await stranger.get(f"/trips/{tid}/members")).status_code == 404
    assert (await stranger.delete(f"/trips/{tid}/membership")).status_code == 404
    assert (await stranger.get("/trips")).json() == []


# ---- members, removing and leaving ----


async def test_the_owner_sees_and_removes_viewers(
    client: AsyncClient, viewer: AsyncClient, viewer_user: UserRecord
) -> None:
    trip = await _shared_trip(client, viewer)
    tid = trip["id"]
    members = (await client.get(f"/trips/{tid}/members")).json()
    assert [(m["email"], m["role"]) for m in members] == [("pripri@example.com", "viewer")]
    assert members[0]["userId"] == str(viewer_user.id)

    assert (await client.delete(f"/trips/{tid}/members/{viewer_user.id}")).status_code == 204
    assert (await client.get(f"/trips/{tid}/members")).json() == []
    assert (await viewer.get(f"/trips/{tid}")).status_code == 404
    assert (await viewer.get("/trips")).json() == []
    # Removing someone who isn't a member is a 404.
    assert (await client.delete(f"/trips/{tid}/members/{viewer_user.id}")).status_code == 404


async def test_a_viewer_can_leave_and_rejoin(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await _shared_trip(client, viewer)
    tid = trip["id"]
    assert (await viewer.delete(f"/trips/{tid}/membership")).status_code == 204
    assert (await viewer.get(f"/trips/{tid}")).status_code == 404
    # Leaving soft-deletes the membership, so joining again works.
    assert (await viewer.post("/trips/join", json={"tripId": tid})).status_code == 200
    assert (await viewer.get(f"/trips/{tid}")).status_code == 200


async def test_the_owner_cannot_leave_their_own_trip(client: AsyncClient) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    assert (await client.delete(f"/trips/{trip['id']}/membership")).status_code == 409


async def test_a_deleted_trip_disappears_for_viewers_too(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await _shared_trip(client, viewer)
    await client.delete(f"/trips/{trip['id']}")
    assert (await viewer.get("/trips")).json() == []
    assert (await viewer.get(f"/trips/{trip['id']}")).status_code == 404
