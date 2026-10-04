"""Sharing a trip: the owner does anything; editors change the trip's days,
activities, stays and travel; viewers read; strangers see nothing."""

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
        ("get", f"/trips/{tid}/edit-code", None),
        ("post", f"/trips/{tid}/edit-code", None),
    ]
    for method, url, body in edits:
        kwargs = {"json": body} if body is not None else {}
        resp = await getattr(viewer, method)(url, **kwargs)
        assert resp.status_code == 403, (method, url, resp.status_code)

    # Nothing changed.
    assert (await client.get(f"/trips/{tid}")).json() == full


# ---- editors ----


async def edited_trip(owner: AsyncClient, editor: AsyncClient) -> dict[str, Any]:
    """Import the sample as `owner` and have `editor` join it with the edit code."""
    trip = (await owner.post("/trips/import", json=load_sample_trip())).json()
    code = (await owner.get(f"/trips/{trip['id']}/edit-code")).json()["code"]
    resp = await editor.post("/trips/join", json={"code": code})
    assert resp.status_code == 200, resp.text
    return trip


async def test_the_edit_code_makes_an_editor(
    client: AsyncClient, viewer: AsyncClient, viewer_user: UserRecord
) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    tid = trip["id"]
    code = (await client.get(f"/trips/{tid}/edit-code")).json()["code"]
    assert len(code) == 20
    assert code != tid
    # Made once: asking again gives the same code.
    assert (await client.get(f"/trips/{tid}/edit-code")).json()["code"] == code

    resp = await viewer.post("/trips/join", json={"code": f"  {code} "})  # pasted with spaces
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "editor"
    assert [(t["id"], t["role"]) for t in (await viewer.get("/trips")).json()] == [(tid, "editor")]
    assert (await viewer.get(f"/trips/{tid}")).json()["role"] == "editor"
    members = (await client.get(f"/trips/{tid}/members")).json()
    assert [(m["userId"], m["role"]) for m in members] == [(str(viewer_user.id), "editor")]


async def test_the_trip_id_in_code_still_makes_a_viewer(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    resp = await viewer.post("/trips/join", json={"code": trip["id"]})
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"


async def test_joining_with_the_other_code_switches_role(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    code = (await client.get(f"/trips/{tid}/edit-code")).json()["code"]
    assert (await viewer.post("/trips/join", json={"code": code})).json()["role"] == "editor"
    assert (await viewer.post("/trips/join", json={"tripId": tid})).json()["role"] == "viewer"
    assert (await viewer.get(f"/trips/{tid}")).json()["role"] == "viewer"
    # Still one membership, not one per code.
    assert len((await client.get(f"/trips/{tid}/members")).json()) == 1


async def test_a_renewed_edit_code_replaces_the_old_one(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    trip = await edited_trip(client, viewer)
    tid = trip["id"]
    old = (await client.get(f"/trips/{tid}/edit-code")).json()["code"]
    new = (await client.post(f"/trips/{tid}/edit-code")).json()["code"]
    assert new != old
    assert (await client.get(f"/trips/{tid}/edit-code")).json()["code"] == new
    assert (await stranger.post("/trips/join", json={"code": old})).status_code == 404
    assert (await stranger.post("/trips/join", json={"code": new})).json()["role"] == "editor"
    # Whoever already joined keeps their role.
    assert (await viewer.get(f"/trips/{tid}")).json()["role"] == "editor"


async def test_joining_needs_a_known_code(client: AsyncClient, viewer: AsyncClient) -> None:
    assert (await viewer.post("/trips/join", json={})).status_code == 422
    assert (await viewer.post("/trips/join", json={"code": "  "})).status_code == 422
    assert (await viewer.post("/trips/join", json={"code": "not-a-code"})).status_code == 404
    # A deleted trip's edit code no longer works.
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    code = (await client.get(f"/trips/{trip['id']}/edit-code")).json()["code"]
    await client.delete(f"/trips/{trip['id']}")
    assert (await viewer.post("/trips/join", json={"code": code})).status_code == 404


async def test_an_editor_changes_days_activities_stays_and_travel(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    editor = viewer
    trip = await edited_trip(client, editor)
    tid = trip["id"]
    full = (await client.get(f"/trips/{tid}")).json()
    stay = full["stays"][0]
    travel = full["travels"][0]
    # A write takes the document shape: no id, no computed zones.
    read_only = {"id", "zone", "departZone", "arriveZone"}
    stay_doc = {k: v for k, v in stay.items() if k not in read_only}
    travel_doc = {k: v for k, v in travel.items() if k not in read_only}

    async def ok(resp: Any) -> dict[str, Any]:
        assert resp.status_code < 300, resp.text
        return resp.json() if resp.status_code != 204 else {}

    added = await ok(
        await editor.post(f"/trips/{tid}/items", json={"date": "2026-05-10", "title": "Pack"})
    )
    item_id = next(i["id"] for d in added["days"] for i in d["items"] if i["title"] == "Pack")
    await ok(
        await editor.put(
            f"/trips/{tid}/items/{item_id}", json={"date": "2026-05-10", "title": "Pack well"}
        )
    )
    await ok(await editor.post(f"/trips/{tid}/items/{item_id}/move", json={"direction": "up"}))
    await ok(await editor.put(f"/trips/{tid}/days/2026-05-10", json={"title": "Travel day"}))
    await ok(
        await editor.put(
            f"/trips/{tid}/stays/{stay['id']}", json={**stay_doc, "notes": "By PriPri"}
        )
    )
    await ok(
        await editor.put(f"/trips/{tid}/travels/{travel['id']}", json={**travel_doc, "seat": "12A"})
    )
    await ok(await editor.post(f"/trips/{tid}/stays", json=stay_doc))
    await ok(await editor.post(f"/trips/{tid}/travels", json=travel_doc))
    await ok(await editor.delete(f"/trips/{tid}/items/{item_id}"))
    await ok(await editor.delete(f"/trips/{tid}/stays/{stay['id']}"))
    await ok(await editor.delete(f"/trips/{tid}/travels/{travel['id']}"))

    # The owner sees the editor's changes.
    after = (await client.get(f"/trips/{tid}")).json()
    assert next(d for d in after["days"] if d["date"] == "2026-05-10")["title"] == "Travel day"
    assert stay["id"] not in [s["id"] for s in after["stays"]]
    assert len(after["stays"]) == len(full["stays"])  # one deleted, one added
    assert travel["id"] not in [t["id"] for t in after["travels"]]


async def test_an_editor_cannot_delete_the_trip_or_manage_who_is_on_it(
    client: AsyncClient, viewer: AsyncClient, viewer_user: UserRecord
) -> None:
    editor = viewer
    trip = await edited_trip(client, editor)
    tid = trip["id"]
    owner_only = [
        ("delete", f"/trips/{tid}"),
        ("get", f"/trips/{tid}/members"),
        ("delete", f"/trips/{tid}/members/{viewer_user.id}"),
        ("get", f"/trips/{tid}/edit-code"),
        ("post", f"/trips/{tid}/edit-code"),
    ]
    for method, url in owner_only:
        resp = await getattr(editor, method)(url)
        assert resp.status_code == 403, (method, url, resp.status_code)
    assert (await client.get(f"/trips/{tid}")).status_code == 200
    # An editor can still leave.
    assert (await editor.delete(f"/trips/{tid}/membership")).status_code == 204
    assert (await editor.get(f"/trips/{tid}")).status_code == 404


async def test_a_stranger_gets_404_everywhere(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    assert (await stranger.get(f"/trips/{tid}")).status_code == 404
    assert (await stranger.delete(f"/trips/{tid}")).status_code == 404
    assert (await stranger.get(f"/trips/{tid}/members")).status_code == 404
    assert (await stranger.delete(f"/trips/{tid}/membership")).status_code == 404
    assert (await stranger.get(f"/trips/{tid}/edit-code")).status_code == 404
    assert (
        await stranger.put(f"/trips/{tid}/days/2026-05-10", json={"title": "x"})
    ).status_code == 404
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
