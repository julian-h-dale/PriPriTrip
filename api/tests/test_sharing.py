"""Sharing a trip: the owner does anything; editors change the trip's days,
activities, stays and travel; viewers read; strangers see nothing."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient

from app.models import UserRecord
from app.sample_data import load_sample_trip
from tests.conftest import UserClient, if_match

PRIPRI = "pripri@example.com"


async def invite(owner: AsyncClient, trip_id: str, email: str, role: str) -> Any:
    return await owner.post(f"/trips/{trip_id}/members", json={"email": email, "role": role})


async def shared_trip(owner: AsyncClient, viewer: UserClient) -> dict[str, Any]:
    """Import the sample as `owner` and add `viewer` as a viewer."""
    trip = (await owner.post("/trips/import", json=load_sample_trip())).json()
    resp = await invite(owner, trip["id"], viewer.email, "viewer")
    assert resp.status_code == 201, resp.text
    return trip


# ---- adding people by email ----


async def test_inviting_as_a_viewer(
    client: AsyncClient, viewer: AsyncClient, viewer_user: UserRecord
) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    resp = await invite(client, trip["id"], PRIPRI, "viewer")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["userId"], body["email"], body["role"]) == (str(viewer_user.id), PRIPRI, "viewer")
    assert body["name"] == ""

    listed = (await viewer.get("/trips")).json()
    assert [(t["id"], t["role"]) for t in listed] == [(trip["id"], "viewer")]
    assert listed[0]["stayCount"] == trip["stayCount"]
    assert (await viewer.get(f"/trips/{trip['id']}")).json()["role"] == "viewer"
    # The owner's own view is unchanged.
    assert (await client.get(f"/trips/{trip['id']}")).json()["role"] == "owner"


async def test_inviting_as_an_editor_ignores_case_and_spaces(
    client: AsyncClient, viewer: AsyncClient, viewer_user: UserRecord
) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    tid = trip["id"]
    resp = await invite(client, tid, "  PriPri@Example.com ", "editor")
    assert resp.status_code == 201, resp.text
    assert (await viewer.get(f"/trips/{tid}")).json()["role"] == "editor"
    members = (await client.get(f"/trips/{tid}/members")).json()
    assert [(m["userId"], m["role"]) for m in members] == [(str(viewer_user.id), "editor")]


async def test_an_unknown_email_is_a_404_and_adds_no_one(client: AsyncClient) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    resp = await invite(client, trip["id"], "nobody@example.com", "viewer")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No account with that email"
    assert (await client.get(f"/trips/{trip['id']}/members")).json() == []


async def test_inviting_needs_an_email_and_a_role(client: AsyncClient) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    assert (await invite(client, trip["id"], "", "viewer")).status_code == 422
    assert (await invite(client, trip["id"], PRIPRI, "owner")).status_code == 422


async def test_the_owner_cannot_invite_themselves(client: AsyncClient) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    assert (await invite(client, trip["id"], "user@example.com", "editor")).status_code == 409


async def test_inviting_again_changes_the_role(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    resp = await invite(client, tid, PRIPRI, "editor")
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"
    assert (await viewer.get(f"/trips/{tid}")).json()["role"] == "editor"
    # Still one membership.
    assert len((await client.get(f"/trips/{tid}/members")).json()) == 1


async def test_the_owner_changes_a_role(
    client: AsyncClient, viewer: AsyncClient, viewer_user: UserRecord
) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    url = f"/trips/{tid}/members/{viewer_user.id}"
    resp = await client.patch(url, json={"role": "editor"})
    assert resp.status_code == 200 and resp.json()["role"] == "editor"
    assert (await viewer.get(f"/trips/{tid}")).json()["role"] == "editor"
    assert (await client.patch(url, json={"role": "boss"})).status_code == 422
    # Not a member: 404.
    other = f"/trips/{tid}/members/{uuid.uuid4()}"
    assert (await client.patch(other, json={"role": "viewer"})).status_code == 404


async def test_only_the_owner_adds_people(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient, viewer_user: UserRecord
) -> None:
    trip = await edited_trip(client, viewer)
    tid = trip["id"]
    assert (await invite(viewer, tid, "stranger@example.com", "viewer")).status_code == 403
    assert (await invite(stranger, tid, "stranger@example.com", "editor")).status_code == 404
    url = f"/trips/{tid}/members/{viewer_user.id}"
    assert (await viewer.patch(url, json={"role": "viewer"})).status_code == 403
    assert (await stranger.patch(url, json={"role": "viewer"})).status_code == 404
    assert (await stranger.get("/trips")).json() == []


async def test_the_join_codes_are_gone(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = (await client.post("/trips/import", json=load_sample_trip())).json()
    tid = trip["id"]
    for kind in ("view", "edit"):
        assert (await client.get(f"/trips/{tid}/{kind}-code")).status_code in (404, 405)
        assert (await client.post(f"/trips/{tid}/{kind}-code")).status_code in (404, 405)
    assert (await viewer.post("/trips/join", json={"tripId": tid})).status_code in (404, 405)
    assert (await viewer.get("/trips")).json() == []


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
        ("post", f"/trips/{tid}/members", {"email": "stranger@example.com", "role": "viewer"}),
    ]
    for method, url, body in edits:
        kwargs = {"json": body} if body is not None else {}
        resp = await getattr(viewer, method)(url, **kwargs)
        assert resp.status_code == 403, (method, url, resp.status_code)

    # Nothing changed.
    assert (await client.get(f"/trips/{tid}")).json() == full


# ---- editors ----


async def edited_trip(owner: AsyncClient, editor: UserClient) -> dict[str, Any]:
    """Import the sample as `owner` and add `editor` as an editor."""
    trip = (await owner.post("/trips/import", json=load_sample_trip())).json()
    resp = await invite(owner, trip["id"], editor.email, "editor")
    assert resp.status_code == 201, resp.text
    return trip


async def test_an_editor_changes_days_activities_stays_and_travel(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    editor = viewer
    trip = await edited_trip(client, editor)
    tid = trip["id"]
    full = (await client.get(f"/trips/{tid}")).json()
    stay = full["stays"][0]
    travel = full["travels"][0]
    # A write takes the document shape: no id, version or computed zones.
    read_only = {
        "id",
        "zone",
        "departZone",
        "arriveZone",
        "durationMinutes",
        "version",
        "updatedAt",
        "updatedByName",
    }
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
            f"/trips/{tid}/items/{item_id}",
            json={"date": "2026-05-10", "title": "Pack well"},
            headers=if_match(1),
        )
    )
    await ok(await editor.post(f"/trips/{tid}/items/{item_id}/move", json={"direction": "up"}))
    # Adding "Pack" made the date's day row (version 1).
    await ok(
        await editor.put(
            f"/trips/{tid}/days/2026-05-10", json={"title": "Travel day"}, headers=if_match(1)
        )
    )
    await ok(
        await editor.put(
            f"/trips/{tid}/stays/{stay['id']}",
            json={**stay_doc, "notes": "By PriPri"},
            headers=if_match(1),
        )
    )
    await ok(
        await editor.put(
            f"/trips/{tid}/travels/{travel['id']}",
            json={**travel_doc, "seat": "12A"},
            headers=if_match(1),
        )
    )
    await ok(await editor.post(f"/trips/{tid}/stays", json=stay_doc))
    await ok(await editor.post(f"/trips/{tid}/travels", json=travel_doc))
    # Moving didn't change the activity's version; each edit did.
    await ok(await editor.delete(f"/trips/{tid}/items/{item_id}", headers=if_match(2)))
    await ok(await editor.delete(f"/trips/{tid}/stays/{stay['id']}", headers=if_match(2)))
    await ok(await editor.delete(f"/trips/{tid}/travels/{travel['id']}", headers=if_match(2)))

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


async def test_a_viewer_can_leave_and_be_invited_again(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    assert (await viewer.delete(f"/trips/{tid}/membership")).status_code == 204
    assert (await viewer.get(f"/trips/{tid}")).status_code == 404
    # Leaving soft-deletes the membership, so a new invite adds them afresh.
    assert (await invite(client, tid, PRIPRI, "viewer")).status_code == 201
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
