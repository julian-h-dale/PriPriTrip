"""Trips API: import, read back, list, delete, ownership, and the schema."""

from __future__ import annotations

import datetime as dt
import json
import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Trip, UserRecord
from app.routers.trips import MAX_UPLOAD_BYTES
from app.sample_data import load_sample_trip
from app.trip_document import trip_json_schema


def strip_server_fields(value: Any) -> Any:
    """Drop ids, audit fields, computed zones and the caller's role so a
    read-back compares to the input."""
    if isinstance(value, dict):
        return {
            k: strip_server_fields(v)
            for k, v in value.items()
            if k not in {"id", "createdAt", "zone", "departZone", "arriveZone", "role"}
        }
    if isinstance(value, list):
        return [strip_server_fields(v) for v in value]
    return value


async def import_sample(client: AsyncClient) -> dict[str, Any]:
    resp = await client.post("/trips/import", json=load_sample_trip())
    assert resp.status_code == 201, resp.text
    body: dict[str, Any] = resp.json()
    return body


async def test_health(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---- import ----


async def test_import_json_body_returns_summary(client: AsyncClient) -> None:
    body = await import_sample(client)
    assert body["name"] == "Bern & Wengen Long Weekend"
    assert body["startDate"] == "2026-05-10"
    assert body["stayCount"] == 2
    assert body["travelCount"] == 4
    uuid.UUID(body["id"])


async def test_import_file_upload(client: AsyncClient) -> None:
    payload = json.dumps(load_sample_trip()).encode()
    resp = await client.post(
        "/trips/import", files={"file": ("trip.json", payload, "application/json")}
    )
    assert resp.status_code == 201, resp.text


async def test_round_trip_returns_the_same_document(client: AsyncClient) -> None:
    trip_id = (await import_sample(client))["id"]
    resp = await client.get(f"/trips/{trip_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == trip_id
    assert all("id" in s for s in body["stays"])
    assert all("id" in i for d in body["days"] for i in d["items"])
    assert strip_server_fields(body) == load_sample_trip()


async def test_importing_twice_creates_two_trips(client: AsyncClient) -> None:
    first = await import_sample(client)
    second = await import_sample(client)
    assert first["id"] != second["id"]
    listed = (await client.get("/trips")).json()
    assert {t["id"] for t in listed} == {first["id"], second["id"]}


async def test_invalid_document_is_rejected_with_paths_and_saves_nothing(
    client: AsyncClient, db: AsyncSession
) -> None:
    doc = load_sample_trip()
    doc["days"][0]["date"] = "2026-06-01"
    doc["travels"][1]["arrive"] = "2026-05-11T09:00"
    resp = await client.post("/trips/import", json=doc)
    assert resp.status_code == 422
    body = resp.json()
    paths = {e["path"] for e in body["errors"]}
    assert {"days[0].date", "travels[1].arrive"} <= paths
    assert "problem" in body["detail"]
    assert (await db.scalar(select(func.count(Trip.id)))) == 0


async def test_structural_errors_are_rejected_with_paths(client: AsyncClient) -> None:
    doc = load_sample_trip()
    doc["stays"][0]["checkin"] = "2026-05-11T14:00"
    resp = await client.post("/trips/import", json=doc)
    assert resp.status_code == 422
    assert {e["path"] for e in resp.json()["errors"]} == {"stays[0].checkin"}


async def test_malformed_json_is_a_400(client: AsyncClient) -> None:
    resp = await client.post(
        "/trips/import", content=b'{"name": ', headers={"content-type": "application/json"}
    )
    assert resp.status_code == 400
    assert "Not valid JSON" in resp.json()["detail"]


async def test_missing_file_field_is_a_400(client: AsyncClient) -> None:
    resp = await client.post(
        "/trips/import", files={"other": ("trip.json", b"{}", "application/json")}
    )
    assert resp.status_code == 400


async def test_oversize_upload_is_a_413(client: AsyncClient) -> None:
    big = b" " * (MAX_UPLOAD_BYTES + 1)
    resp = await client.post(
        "/trips/import", files={"file": ("trip.json", big, "application/json")}
    )
    assert resp.status_code == 413


# ---- list / delete ----


async def test_list_is_soonest_first(client: AsyncClient) -> None:
    later = load_sample_trip()
    await client.post("/trips/import", json=later)
    earlier = {
        "schemaVersion": 1,
        "name": "Earlier",
        "startDate": "2026-01-02",
        "endDate": "2026-01-03",
        "timezone": "America/Chicago",
    }
    await client.post("/trips/import", json=earlier)
    names = [t["name"] for t in (await client.get("/trips")).json()]
    assert names == ["Earlier", "Bern & Wengen Long Weekend"]


async def test_delete_hides_the_trip(client: AsyncClient) -> None:
    trip_id = (await import_sample(client))["id"]
    assert (await client.delete(f"/trips/{trip_id}")).status_code == 204
    assert (await client.get("/trips")).json() == []
    assert (await client.get(f"/trips/{trip_id}")).status_code == 404
    assert (await client.delete(f"/trips/{trip_id}")).status_code == 404


# ---- ownership ----


async def test_another_users_trip_is_a_404(client: AsyncClient, db: AsyncSession) -> None:
    other = UserRecord(
        id=uuid.uuid4(), email="other@example.com", hashed_password="x", is_active=True
    )
    db.add(other)
    await db.commit()  # no ORM relationship orders user before trip in one flush
    trip = Trip(
        user_id=other.id,
        name="Not yours",
        start_date=dt.date(2026, 1, 1),
        end_date=dt.date(2026, 1, 2),
        timezone="UTC",
    )
    db.add(trip)
    await db.commit()
    trip_id = trip.id

    assert (await client.get(f"/trips/{trip_id}")).status_code == 404
    assert (await client.delete(f"/trips/{trip_id}")).status_code == 404
    assert (await client.get("/trips")).json() == []


async def test_unknown_trip_is_a_404(client: AsyncClient) -> None:
    assert (await client.get(f"/trips/{uuid.uuid4()}")).status_code == 404


async def test_anonymous_requests_are_rejected(anon_client: AsyncClient) -> None:
    assert (await anon_client.get("/trips")).status_code == 401
    assert (await anon_client.post("/trips/import", json=load_sample_trip())).status_code == 401
    assert (await anon_client.get(f"/trips/{uuid.uuid4()}")).status_code == 401


async def test_real_token_can_import_and_read(token_client: AsyncClient) -> None:
    trip_id = (await import_sample(token_client))["id"]
    assert (await token_client.get(f"/trips/{trip_id}")).status_code == 200


# ---- schema ----


async def test_schema_is_public_and_matches_the_models(anon_client: AsyncClient) -> None:
    resp = await anon_client.get("/schema/trip")
    assert resp.status_code == 200
    assert resp.json() == trip_json_schema()
