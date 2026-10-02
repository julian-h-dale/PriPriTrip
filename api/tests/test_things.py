"""Smoke + vertical-slice tests for the Thing feature."""

from __future__ import annotations

from httpx import AsyncClient


async def test_health(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_things_empty(client: AsyncClient) -> None:
    resp = await client.get("/things/")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_thing_crud_roundtrip(client: AsyncClient) -> None:
    created = await client.post("/things/", json={"title": "Buy milk", "notes": "2%"})
    assert created.status_code == 201
    body = created.json()
    assert body["title"] == "Buy milk"
    assert "userId" in body  # camelCase at the wire boundary
    thing_id = body["id"]

    listed = await client.get("/things/")
    assert len(listed.json()) == 1

    updated = await client.patch(f"/things/{thing_id}", json={"title": "Buy oat milk"})
    assert updated.status_code == 200
    assert updated.json()["title"] == "Buy oat milk"

    deleted = await client.delete(f"/things/{thing_id}")
    assert deleted.status_code == 204

    # Soft-deleted rows are hidden from normal queries.
    after = await client.get("/things/")
    assert after.json() == []


async def test_unknown_thing_returns_404(client: AsyncClient) -> None:
    import uuid

    resp = await client.patch(f"/things/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404
