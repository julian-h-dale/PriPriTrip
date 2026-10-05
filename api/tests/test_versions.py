"""Versions on a trip's entries (services/versions.py): a change says which
version it was made from, and a stale one is refused with 409 instead of
silently overwriting someone else's change."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

from app.sample_data import load_sample_trip
from tests.conftest import if_match

Json = dict[str, Any]


async def shared_for_editing(owner: AsyncClient, editor: AsyncClient) -> Json:
    """The sample trip, imported by `owner`, joined by `editor` as an editor,
    and read back."""
    trip_id = (await owner.post("/trips/import", json=load_sample_trip())).json()["id"]
    code = (await owner.get(f"/trips/{trip_id}/edit-code")).json()["code"]
    assert (await editor.post("/trips/join", json={"code": code})).status_code == 200
    body: Json = (await owner.get(f"/trips/{trip_id}")).json()
    return body


def find_item(trip: Json, title: str) -> Json:
    return next(i for d in trip["days"] for i in d["items"] if i["title"] == title)


def lunch_write(title: str) -> Json:
    return {"date": "2026-05-11", "title": title}


async def test_entries_read_back_at_version_1_with_no_editor(client: AsyncClient) -> None:
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    trip = (await client.get(f"/trips/{trip_id}")).json()
    entries = [*trip["stays"], *trip["travels"], *trip["days"]]
    entries += [i for d in trip["days"] for i in d["items"]]
    assert {e["version"] for e in entries} == {1}
    assert not any("updatedAt" in e or "updatedByName" in e for e in entries)
    assert not any("updatedBy" in e for e in entries)  # the id is never sent


async def test_a_matching_version_saves_and_records_who(client: AsyncClient) -> None:
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    lunch = find_item((await client.get(f"/trips/{trip_id}")).json(), "Lunch at Altes Tramdepot")
    resp = await client.put(
        f"/trips/{trip_id}/items/{lunch['id']}", json=lunch_write("Lunch"), headers=if_match(1)
    )
    assert resp.status_code == 200, resp.text
    saved = find_item(resp.json(), "Lunch")
    assert saved["version"] == 2
    assert saved["updatedByName"] == "Test User"
    assert saved["updatedAt"].endswith(("Z", "+00:00"))
    # An ETag's weak form and a bare number are read the same way.
    for header in ('W/"2"', "3 "):
        resp = await client.put(
            f"/trips/{trip_id}/items/{lunch['id']}",
            json=lunch_write("Lunch"),
            headers={"If-Match": header},
        )
        assert resp.status_code == 200, (header, resp.text)
    assert find_item(resp.json(), "Lunch")["version"] == 4


async def test_a_stale_change_is_refused_with_who_got_there_first(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    """The owner and PriPri both open the lunch; PriPri saves first."""
    trip = await shared_for_editing(client, viewer)
    tid = trip["id"]
    lunch = find_item(trip, "Lunch at Altes Tramdepot")
    url = f"/trips/{tid}/items/{lunch['id']}"
    assert (
        await viewer.put(url, json=lunch_write("Lunch, PriPri's way"), headers=if_match(1))
    ).status_code == 200

    resp = await client.put(url, json=lunch_write("Lunch, my way"), headers=if_match(1))
    assert resp.status_code == 409
    conflict = resp.json()["detail"]
    assert conflict["version"] == 2
    assert conflict["updatedByName"] == "pripri"  # no name set: the email's first part
    assert conflict["updatedAt"]
    assert conflict["current"]["id"] == lunch["id"]
    assert conflict["current"]["title"] == "Lunch, PriPri's way"
    # Nothing was overwritten, and a delete from the old version is refused too.
    assert (await client.delete(url, headers=if_match(1))).status_code == 409
    after = (await client.get(f"/trips/{tid}")).json()
    assert find_item(after, "Lunch, PriPri's way")["version"] == 2


async def test_stays_and_travel_are_versioned_too(client: AsyncClient) -> None:
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    trip = (await client.get(f"/trips/{trip_id}")).json()
    stay = trip["stays"][0]
    travel = trip["travels"][0]
    read_only = {"id", "zone", "departZone", "arriveZone", "version", "updatedAt", "updatedByName"}
    stay_doc = {k: v for k, v in stay.items() if k not in read_only}
    travel_doc = {k: v for k, v in travel.items() if k not in read_only}
    for url, doc in [
        (f"/trips/{trip_id}/stays/{stay['id']}", stay_doc),
        (f"/trips/{trip_id}/travels/{travel['id']}", travel_doc),
    ]:
        assert (await client.put(url, json=doc, headers=if_match(1))).status_code == 200
        assert (await client.put(url, json=doc, headers=if_match(1))).status_code == 409
        assert (await client.delete(url, headers=if_match(1))).status_code == 409
        assert (await client.delete(url, headers=if_match(2))).status_code == 200


async def test_without_a_version_a_change_is_428(client: AsyncClient) -> None:
    """Only an out-of-date app sends none; it mustn't overwrite anyone."""
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    trip = (await client.get(f"/trips/{trip_id}")).json()
    lunch = find_item(trip, "Lunch at Altes Tramdepot")
    stay = trip["stays"][0]
    travel = trip["travels"][0]
    changes = [
        ("put", f"/trips/{trip_id}/items/{lunch['id']}", lunch_write("x")),
        ("delete", f"/trips/{trip_id}/items/{lunch['id']}", None),
        ("put", f"/trips/{trip_id}/days/2026-05-11", {"title": "x"}),
        ("put", f"/trips/{trip_id}/stays/{stay['id']}", {"name": "x"}),
        ("delete", f"/trips/{trip_id}/stays/{stay['id']}", None),
        ("put", f"/trips/{trip_id}/travels/{travel['id']}", {"title": "x"}),
        ("delete", f"/trips/{trip_id}/travels/{travel['id']}", None),
    ]
    for method, url, body in changes:
        kwargs = {"json": body} if body is not None else {}
        resp = await getattr(client, method)(url, **kwargs)
        assert resp.status_code == 428, (method, url, resp.status_code)
        assert "reopen" in resp.json()["detail"]
    assert (await client.get(f"/trips/{trip_id}")).json() == trip  # nothing changed


async def test_a_malformed_version_is_400(client: AsyncClient) -> None:
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    lunch = find_item((await client.get(f"/trips/{trip_id}")).json(), "Lunch at Altes Tramdepot")
    resp = await client.put(
        f"/trips/{trip_id}/items/{lunch['id']}",
        json=lunch_write("x"),
        headers={"If-Match": "*"},
    )
    assert resp.status_code == 400


async def test_an_entry_deleted_meanwhile_is_404(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await shared_for_editing(client, viewer)
    url = f"/trips/{trip['id']}/items/{find_item(trip, 'Lunch at Altes Tramdepot')['id']}"
    assert (await viewer.delete(url, headers=if_match(1))).status_code == 200
    assert (await client.put(url, json=lunch_write("x"), headers=if_match(1))).status_code == 404
    assert (await client.delete(url, headers=if_match(1))).status_code == 404


async def test_adding_and_moving_need_no_version_and_moving_keeps_it(client: AsyncClient) -> None:
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    added = await client.post(f"/trips/{trip_id}/items", json=lunch_write("Coffee"))
    assert added.status_code == 201
    coffee = find_item(added.json(), "Coffee")
    assert (coffee["version"], coffee["updatedByName"]) == (1, "Test User")

    moved = await client.post(
        f"/trips/{trip_id}/items/{coffee['id']}/move", json={"direction": "up"}
    )
    assert moved.status_code == 200
    assert find_item(moved.json(), "Coffee")["version"] == 1
    # Its neighbour was renumbered, not changed.
    assert find_item(moved.json(), "Dinner at Kornhauskeller")["version"] == 1


async def test_a_day_without_a_row_is_version_0(client: AsyncClient, viewer: AsyncClient) -> None:
    """Both open the untitled 10th; PriPri titles it first (making its row)."""
    trip = await shared_for_editing(client, viewer)
    url = f"/trips/{trip['id']}/days/2026-05-10"
    assert not any(d["date"] == "2026-05-10" for d in trip["days"])
    resp = await viewer.put(url, json={"title": "Fly out"}, headers=if_match(0))
    assert resp.status_code == 200
    day = next(d for d in resp.json()["days"] if d["date"] == "2026-05-10")
    assert (day["version"], day["updatedByName"]) == (1, "pripri")

    resp = await client.put(url, json={"title": "Travel day"}, headers=if_match(0))
    assert resp.status_code == 409
    assert resp.json()["detail"]["current"]["title"] == "Fly out"
    assert (
        await client.put(url, json={"title": "Travel day"}, headers=if_match(1))
    ).status_code == 200
