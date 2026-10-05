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
from tests.test_sharing import shared_trip

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


async def test_a_viewer_can_export(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await shared_trip(client, viewer)
    resp = await viewer.get(f"/trips/{trip['id']}/export")
    assert resp.status_code == 200
    assert resp.json() == load_sample_trip()


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
