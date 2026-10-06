"""Public and private memories (Phase 46). The owner and editors see every
memory; viewers (people following the trip) see only public ones, can't write
any, and never see a booking's confirmation number.

Here `viewer` (pripri@) joins as an editor and `stranger` joins as a viewer —
the in-laws."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.settings import get_app_settings
from tests.test_photos import _upload, jpeg
from tests.test_sharing import edited_trip, view_code


@pytest.fixture(autouse=True)
def photo_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "photos"
    monkeypatch.setattr(get_app_settings(), "photo_dir", str(root))
    return root


async def _trip(owner: AsyncClient, editor: AsyncClient, follower: AsyncClient) -> str:
    """The sample trip, with an editor and a viewer (`follower`) on it."""
    tid = str((await edited_trip(owner, editor))["id"])
    resp = await follower.post("/trips/join", json={"code": await view_code(owner, tid)})
    assert resp.json()["role"] == "viewer"
    return tid


async def _write(client: AsyncClient, tid: str, text: str, **extra: Any) -> dict[str, Any]:
    resp = await client.post(f"/trips/{tid}/memories", json={"text": text, "zone": "UTC", **extra})
    assert resp.status_code == 201, resp.text
    body: dict[str, Any] = resp.json()
    return body


async def _texts(client: AsyncClient, tid: str) -> list[str]:
    return [m["text"] for m in (await client.get(f"/trips/{tid}/memories")).json()]


async def test_memories_are_private_unless_marked_public(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    private = await _write(client, tid, "just us")
    shared = await _write(viewer, tid, "the beach", isPublic=True)
    assert private["isPublic"] is False
    assert shared["isPublic"] is True

    # The owner and editors see every memory, with its flag.
    assert await _texts(client, tid) == ["just us", "the beach"]
    assert await _texts(viewer, tid) == ["just us", "the beach"]
    # A viewer sees only the public one.
    assert await _texts(stranger, tid) == ["the beach"]


async def test_the_author_flips_it_and_leaving_it_out_keeps_it(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    memory = await _write(client, tid, "dinner")
    url = f"/trips/{tid}/memories/{memory['id']}"

    made_public = (await client.put(url, json={"text": "dinner", "isPublic": True})).json()
    assert made_public["isPublic"] is True
    assert await _texts(stranger, tid) == ["dinner"]
    # An edit that doesn't mention it keeps it.
    assert (await client.put(url, json={"text": "dinner!"})).json()["isPublic"] is True
    # Private again: gone for the viewer.
    await client.put(url, json={"text": "dinner!", "isPublic": False})
    assert await _texts(stranger, tid) == []

    # Another editor can't flip it (only the author changes a memory).
    assert (await viewer.put(url, json={"text": "x", "isPublic": True})).status_code == 403


async def test_a_viewer_cannot_write_or_touch_a_private_memory(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    resp = await stranger.post(f"/trips/{tid}/memories", json={"text": "hi", "zone": "UTC"})
    assert resp.status_code == 403

    private = await _write(client, tid, "just us")
    public = await _write(client, tid, "shared", isPublic=True)
    # A private memory doesn't exist as far as a viewer can tell: 404.
    for method in ("put", "delete"):
        url = f"/trips/{tid}/memories/{private['id']}"
        kwargs: dict[str, Any] = {"json": {"text": "x"}} if method == "put" else {}
        assert (await getattr(stranger, method)(url, **kwargs)).status_code == 404
    # A public one they can see, but it isn't theirs: 403.
    assert (
        await stranger.put(f"/trips/{tid}/memories/{public['id']}", json={"text": "x"})
    ).status_code == 403


async def test_a_viewer_never_gets_a_private_photo(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    private = await _write(client, tid, "private, with a photo")
    public = await _write(client, tid, "public, with a photo", isPublic=True)
    hidden = (await _upload(client, tid, private["id"], jpeg(64, 48))).json()
    shown = (await _upload(client, tid, public["id"], jpeg(64, 48))).json()

    listed = (await stranger.get(f"/trips/{tid}/memories")).json()
    assert [p["id"] for m in listed for p in m["photos"]] == [shown["id"]]
    assert hidden["id"] not in str(listed)
    # Uploading to someone else's private memory is a 404 for a viewer too.
    assert (await _upload(stranger, tid, private["id"], jpeg(64, 48))).status_code == 404


async def test_a_viewer_sees_no_confirmation_numbers(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    for who in (client, viewer):
        assert "confirmationNumber" in (await who.get(f"/trips/{tid}")).text
    as_viewer = await stranger.get(f"/trips/{tid}")
    assert as_viewer.status_code == 200
    assert "confirmationNumber" not in as_viewer.text
    # Everything else is still there.
    assert (
        as_viewer.json()["stays"][0]["name"]
        == (await client.get(f"/trips/{tid}")).json()["stays"][0]["name"]
    )
