"""Exporting a trip: a clean trip document that imports as it is."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from httpx import AsyncClient

from app.sample_data import load_sample_trip
from app.trip_document import validate_trip_document
from tests.conftest import if_match
from tests.test_sharing import edited_trip, shared_trip

EXAMPLE_TRIP = Path(__file__).parents[2] / "example-trip.json"


async def import_doc(client: AsyncClient, doc: dict[str, Any]) -> str:
    resp = await client.post("/trips/import", json=doc)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def test_export_equals_the_imported_sample(client: AsyncClient) -> None:
    trip_id = await import_doc(client, load_sample_trip())
    resp = await client.get(f"/trips/{trip_id}/export")
    assert resp.status_code == 200
    assert resp.json() == load_sample_trip()


async def test_export_equals_the_example_trip(client: AsyncClient) -> None:
    original = json.loads(EXAMPLE_TRIP.read_text(encoding="utf-8"))
    trip_id = await import_doc(client, original)
    assert (await client.get(f"/trips/{trip_id}/export")).json() == original


async def test_export_is_a_valid_document_that_imports_again(client: AsyncClient) -> None:
    trip_id = await import_doc(client, load_sample_trip())
    exported = (await client.get(f"/trips/{trip_id}/export")).json()
    validate_trip_document(exported)
    assert await import_doc(client, exported) != trip_id


async def test_export_carries_no_server_fields(client: AsyncClient) -> None:
    trip_id = await import_doc(client, load_sample_trip())
    text = (await client.get(f"/trips/{trip_id}/export")).text
    for key in ('"id"', '"role"', '"zone"', '"departZone"', '"version"', '"updatedAt"'):
        assert key not in text


async def test_export_downloads_as_a_named_file(client: AsyncClient) -> None:
    trip_id = await import_doc(client, load_sample_trip())
    resp = await client.get(f"/trips/{trip_id}/export")
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.headers["content-disposition"] == (
        'attachment; filename="bern-wengen-long-weekend.json"'
    )


async def test_export_leaves_out_deleted_entries(client: AsyncClient) -> None:
    trip_id = await import_doc(client, load_sample_trip())
    trip = (await client.get(f"/trips/{trip_id}")).json()
    stay = trip["stays"][0]
    resp = await client.delete(
        f"/trips/{trip_id}/stays/{stay['id']}", headers=if_match(stay["version"])
    )
    assert resp.status_code == 200, resp.text
    item = next(i for d in trip["days"] for i in d["items"])
    resp = await client.delete(
        f"/trips/{trip_id}/items/{item['id']}", headers=if_match(item["version"])
    )
    assert resp.status_code == 200, resp.text
    exported = (await client.get(f"/trips/{trip_id}/export")).json()
    assert [s["name"] for s in exported["stays"]] == [s["name"] for s in trip["stays"][1:]]
    titles = [i["title"] for d in exported["days"] for i in d.get("items", [])]
    assert item["title"] not in titles


async def test_a_viewer_can_export_without_confirmation_numbers_or_private_places(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    """As their read: no confirmation numbers, stays' and legs' places only
    by name and city (Run stage 17), and no plan B (Run stage 25)."""
    trip = await shared_trip(client, viewer)
    resp = await viewer.get(f"/trips/{trip['id']}/export")
    assert resp.status_code == 200
    expected = load_sample_trip()
    assert "confirmationNumber" in str(expected)  # the sample has some to hide
    assert any("planB" in d for d in expected["days"])  # and a plan B
    for day in expected["days"]:
        day.pop("planB", None)
    for entry in [*expected["stays"], *expected["travels"]] + [
        i for d in expected["days"] for i in d.get("items", [])
    ]:
        entry.pop("confirmationNumber", None)

    def name_and_city(loc: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in loc.items() if k in ("name", "city")}

    for stay in expected["stays"]:
        if "location" in stay:
            stay["location"] = name_and_city(stay["location"])
    for travel in expected["travels"]:
        for end in ("from", "to"):
            if end in travel:
                travel[end] = name_and_city(travel[end])
    assert resp.json() == expected


async def test_an_editor_exports_everything(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await edited_trip(client, viewer)
    assert (await viewer.get(f"/trips/{trip['id']}/export")).json() == load_sample_trip()


async def test_a_stranger_gets_404(client: AsyncClient, stranger: AsyncClient) -> None:
    trip_id = await import_doc(client, load_sample_trip())
    assert (await stranger.get(f"/trips/{trip_id}/export")).status_code == 404
    assert (await client.get(f"/trips/{uuid.uuid4()}/export")).status_code == 404


async def test_a_deleted_trip_cannot_be_exported(client: AsyncClient) -> None:
    trip_id = await import_doc(client, load_sample_trip())
    await client.delete(f"/trips/{trip_id}")
    assert (await client.get(f"/trips/{trip_id}/export")).status_code == 404


async def test_signed_out_is_401(anon_client: AsyncClient) -> None:
    assert (await anon_client.get(f"/trips/{uuid.uuid4()}/export")).status_code == 401
