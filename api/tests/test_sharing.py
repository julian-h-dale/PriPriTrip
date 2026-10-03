"""Sharing a trip: the owner edits; viewers (members) read; strangers see nothing."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient

from app.models import UserRecord
from app.sample_data import load_sample_trip


async def shared_trip(owner: AsyncClient, viewer: AsyncClient) -> dict[str, Any]:
    """Import the sample as `owner` and have `viewer` join it."""
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
    trip = await shared_trip(client, viewer)
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
    trip = await shared_trip(client, viewer)
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
    trip = await shared_trip(client, viewer)
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
    trip = await shared_trip(client, viewer)
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
    trip = await shared_trip(client, viewer)
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
    trip = await shared_trip(client, viewer)
    await client.delete(f"/trips/{trip['id']}")
    assert (await viewer.get("/trips")).json() == []
    assert (await viewer.get(f"/trips/{trip['id']}")).status_code == 404
