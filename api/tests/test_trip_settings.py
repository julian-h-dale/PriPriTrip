"""Trip settings (Run stage 29): renaming a trip and its card's cover, an
emoji or a photo from a public memory. The owner and editors change them;
viewers read them; strangers see nothing.

Here `viewer` (pripri@) is made an editor and `stranger` a viewer."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.models import UserRecord
from app.sample_data import load_sample_trip
from app.schemas import is_one_emoji
from app.settings import get_app_settings
from tests.test_photos import _upload, jpeg
from tests.test_sharing import edited_trip, invite


@pytest.fixture(autouse=True)
def photo_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "photos"
    monkeypatch.setattr(get_app_settings(), "photo_dir", str(root))
    return root


async def _trip(owner: AsyncClient, editor: AsyncClient, follower: AsyncClient) -> str:
    tid = str((await edited_trip(owner, editor))["id"])
    assert (await invite(owner, tid, follower.email, "viewer")).json()["role"] == "viewer"
    return tid


async def _photo(
    client: AsyncClient, tid: str, *, public: bool
) -> tuple[dict[str, Any], dict[str, Any]]:
    """A memory with one photo: (memory, photo)."""
    memory = (
        await client.post(
            f"/trips/{tid}/memories", json={"text": "view", "zone": "UTC", "isPublic": public}
        )
    ).json()
    photo = (await _upload(client, tid, memory["id"], jpeg(64, 48))).json()
    return memory, photo


async def _summary(client: AsyncClient, tid: str) -> dict[str, Any]:
    return next(t for t in (await client.get("/trips")).json() if t["id"] == tid)


# ---- renaming ----


async def test_the_owner_and_an_editor_rename_the_trip(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    resp = await client.patch(f"/trips/{tid}", json={"name": "  Swiss Alps  "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Swiss Alps"  # trimmed
    assert resp.json()["role"] == "owner"

    resp = await viewer.patch(f"/trips/{tid}", json={"name": "Alps, again"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "editor"
    # Everyone reads the new name, in the list and the trip.
    assert (await _summary(stranger, tid))["name"] == "Alps, again"
    assert (await client.get(f"/trips/{tid}")).json()["name"] == "Alps, again"


async def test_a_viewer_gets_403_and_a_stranger_404(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient, viewer_user: UserRecord
) -> None:
    tid = await _trip(client, viewer, stranger)
    # Here `stranger` is the viewer; `viewer` stops being on the trip.
    assert (await stranger.patch(f"/trips/{tid}", json={"name": "Mine"})).status_code == 403
    assert (await client.delete(f"/trips/{tid}/members/{viewer_user.id}")).status_code == 204
    assert (await viewer.patch(f"/trips/{tid}", json={"name": "Mine"})).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 121},
        {"name": None},
        {"title": "typo"},
        {"coverEmoji": "mountains"},
        {"coverEmoji": "🏔️🏔️"},
        {"coverEmoji": "🏔️", "coverPhotoId": "00000000-0000-0000-0000-000000000001"},
    ],
)
async def test_bad_updates_are_422_and_change_nothing(
    client: AsyncClient, body: dict[str, Any]
) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    resp = await client.patch(f"/trips/{tid}", json=body)
    assert resp.status_code == 422, resp.text
    trip = await _summary(client, tid)
    assert trip["name"] == load_sample_trip()["name"]
    assert "coverEmoji" not in trip or trip["coverEmoji"] is None


# ---- the cover ----


async def test_an_emoji_cover_shows_for_everyone(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    resp = await viewer.patch(f"/trips/{tid}", json={"coverEmoji": "🏔️"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["coverEmoji"] == "🏔️"
    assert (await _summary(stranger, tid))["coverEmoji"] == "🏔️"
    assert (await stranger.get(f"/trips/{tid}")).json()["coverEmoji"] == "🏔️"
    # Renaming leaves the cover alone; null clears it.
    await client.patch(f"/trips/{tid}", json={"name": "Alps"})
    assert (await _summary(client, tid))["coverEmoji"] == "🏔️"
    await client.patch(f"/trips/{tid}", json={"coverEmoji": None})
    assert (await _summary(client, tid)).get("coverEmoji") is None


async def test_a_photo_cover_from_a_public_memory(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    await client.patch(f"/trips/{tid}", json={"coverEmoji": "🏔️"})
    _, photo = await _photo(viewer, tid, public=True)
    resp = await client.patch(f"/trips/{tid}", json={"coverPhotoId": photo["id"]})
    assert resp.status_code == 200, resp.text
    # A photo replaces the emoji.
    assert resp.json()["coverEmoji"] is None
    assert resp.json()["coverThumbUrl"] == photo["thumbUrl"]
    assert (await _summary(stranger, tid))["coverThumbUrl"] == photo["thumbUrl"]
    assert (await stranger.get(f"/trips/{tid}")).json()["coverThumbUrl"] == photo["thumbUrl"]
    # And an emoji replaces the photo.
    resp = await client.patch(f"/trips/{tid}", json={"coverEmoji": "🌋"})
    assert resp.json()["coverThumbUrl"] is None


async def test_a_private_or_foreign_photo_cannot_be_the_cover(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = await _trip(client, viewer, stranger)
    _, private = await _photo(client, tid, public=False)
    resp = await client.patch(f"/trips/{tid}", json={"coverPhotoId": private["id"]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Pick a photo from a memory everyone can see."

    other = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    _, elsewhere = await _photo(client, other, public=True)
    assert (
        await client.patch(f"/trips/{tid}", json={"coverPhotoId": elsewhere["id"]})
    ).status_code == 422
    assert (await _summary(client, tid)).get("coverThumbUrl") is None


@pytest.mark.parametrize("how", ["made private", "memory deleted", "photo deleted"])
async def test_a_cover_photo_that_stops_being_public_shows_no_cover(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient, how: str
) -> None:
    tid = await _trip(client, viewer, stranger)
    memory, photo = await _photo(client, tid, public=True)
    await client.patch(f"/trips/{tid}", json={"coverPhotoId": photo["id"]})
    base = f"/trips/{tid}/memories/{memory['id']}"
    if how == "made private":
        resp = await client.put(base, json={"text": "view", "isPublic": False})
    elif how == "memory deleted":
        resp = await client.delete(base)
    else:
        resp = await client.delete(f"{base}/photos/{photo['id']}")
    assert resp.status_code in (200, 204), resp.text
    for who in (client, stranger):
        assert (await _summary(who, tid)).get("coverThumbUrl") is None
        assert (await who.get(f"/trips/{tid}")).json().get("coverThumbUrl") is None


def test_what_counts_as_one_emoji() -> None:
    for one in ["🏔️", "✈️", "☀", "🇨🇭", "👩‍👩‍👧", "👍🏽", "1️⃣", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]:
        assert is_one_emoji(one), one
    for not_one in ["", "a", "ab", "🏔️🏔️", "🇨", "🏔 ", "1", "♥x"]:
        assert not is_one_emoji(not_one), not_one
