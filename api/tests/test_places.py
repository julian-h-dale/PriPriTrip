"""Points of interest (Run stage 16): places on the trip's map, on no day.
Added, changed and deleted like stays (versions, soft delete, editors only),
read back with the trip, and carried by the trip document."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

from app.sample_data import load_sample_trip
from app.trip_document import validate_trip_document
from tests.conftest import if_match
from tests.test_sharing import edited_trip, shared_trip

Json = dict[str, Any]

MARKET = {
    "name": "Bern farmers' market",
    "category": "market",
    "location": {
        "name": "Bundesplatz",
        "address": "Bundesplatz, 3011 Bern",
        "lat": 46.9467,
        "lng": 7.4442,
        "placeId": "ChIJmarket",
    },
    "notes": "Tuesday and Saturday mornings.",
}


async def new_trip(client: AsyncClient) -> str:
    return str((await client.post("/trips/import", json=load_sample_trip())).json()["id"])


async def add(client: AsyncClient, trip_id: str, body: Json = MARKET) -> Json:
    resp = await client.post(f"/trips/{trip_id}/places", json=body)
    assert resp.status_code == 201, resp.text
    place: Json = resp.json()["places"][-1]
    return place


async def test_a_new_trip_has_no_places(client: AsyncClient) -> None:
    trip = (await client.get(f"/trips/{await new_trip(client)}")).json()
    assert trip["places"] == []


async def test_add_a_place(client: AsyncClient) -> None:
    trip_id = await new_trip(client)
    place = await add(client, trip_id)
    assert place["name"] == "Bern farmers' market"
    assert place["category"] == "market"
    assert place["location"]["lat"] == 46.9467
    assert place["notes"] == "Tuesday and Saturday mornings."
    assert place["version"] == 1
    assert place["updatedByName"] == "Test User"
    # Read back with the trip, and on no day.
    trip = (await client.get(f"/trips/{trip_id}")).json()
    assert [p["id"] for p in trip["places"]] == [place["id"]]
    assert all(i["title"] != place["name"] for d in trip["days"] for i in d["items"])


async def test_category_defaults_to_other(client: AsyncClient) -> None:
    place = await add(client, await new_trip(client), {"name": "x", "location": MARKET["location"]})
    assert place["category"] == "other"


async def test_a_place_needs_coordinates_and_a_known_category(client: AsyncClient) -> None:
    trip_id = await new_trip(client)
    no_coords = {**MARKET, "location": {"name": "Somewhere"}}
    resp = await client.post(f"/trips/{trip_id}/places", json=no_coords)
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["path"] == "location"
    resp = await client.post(f"/trips/{trip_id}/places", json={**MARKET, "category": "bar"})
    assert resp.status_code == 422
    resp = await client.post(f"/trips/{trip_id}/places", json={**MARKET, "name": " "})
    assert resp.status_code == 422


async def test_replace_and_delete_a_place(client: AsyncClient) -> None:
    trip_id = await new_trip(client)
    place = await add(client, trip_id)
    url = f"/trips/{trip_id}/places/{place['id']}"
    resp = await client.put(url, json={**MARKET, "category": "food"}, headers=if_match(1))
    assert resp.status_code == 200, resp.text
    changed = resp.json()["places"][0]
    assert (changed["category"], changed["version"]) == ("food", 2)

    resp = await client.delete(url, headers=if_match(2))
    assert resp.status_code == 200
    assert resp.json()["places"] == []
    # Soft-deleted: gone from reads, and gone for further edits.
    assert (await client.get(f"/trips/{trip_id}")).json()["places"] == []
    assert (await client.put(url, json=MARKET, headers=if_match(3))).status_code == 404


async def test_a_stale_version_is_a_409_with_theirs(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await edited_trip(client, viewer)  # `viewer` joined with the edit code: an editor
    place = await add(client, trip["id"])
    url = f"/trips/{trip['id']}/places/{place['id']}"
    resp = await viewer.put(url, json={**MARKET, "notes": "Theirs"}, headers=if_match(1))
    assert resp.status_code == 200, resp.text
    resp = await client.put(url, json={**MARKET, "notes": "Mine"}, headers=if_match(1))
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["version"] == 2
    assert detail["current"]["notes"] == "Theirs"
    resp = await client.delete(url, headers=if_match(1))
    assert resp.status_code == 409


async def test_an_editor_adds_places(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await edited_trip(client, viewer)
    await add(viewer, trip["id"])
    assert len((await client.get(f"/trips/{trip['id']}")).json()["places"]) == 1


async def test_a_viewer_sees_places_but_cannot_change_them(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    place = await add(client, trip["id"])
    assert (await viewer.get(f"/trips/{trip['id']}")).json()["places"][0]["id"] == place["id"]
    url = f"/trips/{trip['id']}/places"
    assert (await viewer.post(url, json=MARKET)).status_code == 403
    one = f"{url}/{place['id']}"
    assert (await viewer.put(one, json=MARKET, headers=if_match(1))).status_code == 403
    assert (await viewer.delete(one, headers=if_match(1))).status_code == 403


async def test_a_stranger_or_another_trip_gets_404(
    client: AsyncClient, stranger: AsyncClient
) -> None:
    trip_id = await new_trip(client)
    place = await add(client, trip_id)
    assert (await stranger.post(f"/trips/{trip_id}/places", json=MARKET)).status_code == 404
    other = await new_trip(client)
    resp = await client.put(
        f"/trips/{other}/places/{place['id']}", json=MARKET, headers=if_match(1)
    )
    assert resp.status_code == 404


async def test_signed_out_is_401(anon_client: AsyncClient) -> None:
    resp = await anon_client.post("/trips/00000000-0000-0000-0000-000000000000/places", json=MARKET)
    assert resp.status_code == 401


# ---- the trip document ----


async def test_import_and_export_carry_places(client: AsyncClient) -> None:
    doc = {**load_sample_trip(), "places": [MARKET]}
    trip_id = str((await client.post("/trips/import", json=doc)).json()["id"])
    trip = (await client.get(f"/trips/{trip_id}")).json()
    assert [(p["name"], p["category"]) for p in trip["places"]] == [
        ("Bern farmers' market", "market")
    ]
    assert (await client.get(f"/trips/{trip_id}/export")).json() == doc


async def test_a_trip_without_places_exports_without_the_key(client: AsyncClient) -> None:
    trip_id = await new_trip(client)
    assert "places" not in (await client.get(f"/trips/{trip_id}/export")).json()


async def test_export_leaves_out_deleted_places(client: AsyncClient) -> None:
    trip_id = await new_trip(client)
    place = await add(client, trip_id)
    await add(client, trip_id, {**MARKET, "name": "Loeb department store", "category": "shop"})
    await client.delete(f"/trips/{trip_id}/places/{place['id']}", headers=if_match(1))
    exported = (await client.get(f"/trips/{trip_id}/export")).json()
    assert [p["name"] for p in exported["places"]] == ["Loeb department store"]


def test_a_document_place_without_coordinates_is_rejected() -> None:
    doc = {**load_sample_trip(), "places": [{"name": "Somewhere", "location": {"name": "x"}}]}
    try:
        validate_trip_document(doc)
    except Exception as exc:  # TripDocumentError
        assert [e.path for e in exc.errors] == ["places[0].location"]  # type: ignore[attr-defined]
    else:
        raise AssertionError("expected the document to be rejected")
