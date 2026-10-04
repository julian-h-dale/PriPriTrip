"""The photo backfill script: which locations it touches, the two paths
(already has a place id vs. resolved by a name search), and idempotency."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.backfill_photos import _backfill_items, _backfill_stays, _backfill_travels

Json = dict[str, Any]

# An otherwise-empty trip, so a test's own stays/travels/items are the only
# locations in play — the sample trip's own (placeId-less) locations would
# otherwise also get swept into the name-search path and skew the counts.
EMPTY_TRIP = {
    "schemaVersion": 1,
    "name": "Empty",
    "startDate": "2026-05-10",
    "endDate": "2026-05-20",
    "timezone": "UTC",
}

PHOTOS = {"has-photo": "https://places.googleapis.com/v1/places/has-photo/photos/x/media"}


async def fake_fetch(place_id: str) -> str | None:
    if place_id not in PHOTOS and place_id != "no-photo":
        raise AssertionError(f"unexpected photo lookup for {place_id!r} — should have been skipped")
    return PHOTOS.get(place_id)


async def fake_find_place_id(query: str) -> str | None:
    return "has-photo" if "Findable" in query else None


@pytest.fixture
def patch_google(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.backfill_photos.fetch_first_photo_url", fake_fetch)
    monkeypatch.setattr("app.backfill_photos.find_place_id", fake_find_place_id)


@pytest.fixture
async def trip(client: AsyncClient) -> Json:
    return (await client.post("/trips/import", json=EMPTY_TRIP)).json()


async def test_backfills_a_stay_that_already_has_a_place_id(
    client: AsyncClient, db: AsyncSession, trip: Json, patch_google: None
) -> None:
    await client.post(
        f"/trips/{trip['id']}/stays",
        json={
            "name": "Has photo",
            "checkIn": "2026-05-14T15:00",
            "checkOut": "2026-05-15T11:00",
            "location": {"name": "Has photo", "placeId": "has-photo"},
        },
    )
    checked, updated = await _backfill_stays(db)
    await db.commit()
    assert (checked, updated) == (1, 1)

    stays = (await client.get(f"/trips/{trip['id']}")).json()["stays"]
    backfilled = next(s for s in stays if s["name"] == "Has photo")
    assert backfilled["location"]["imgRef"] == PHOTOS["has-photo"]


async def test_resolves_a_stay_with_no_place_id_by_searching_its_name(
    client: AsyncClient, db: AsyncSession, trip: Json, patch_google: None
) -> None:
    await client.post(
        f"/trips/{trip['id']}/stays",
        json={
            "name": "Findable Hotel",
            "checkIn": "2026-05-14T15:00",
            "checkOut": "2026-05-15T11:00",
            "location": {"name": "Findable Hotel", "address": "123 Main St"},
        },
    )
    checked, updated = await _backfill_stays(db)
    await db.commit()
    assert (checked, updated) == (1, 1)

    stays = (await client.get(f"/trips/{trip['id']}")).json()["stays"]
    backfilled = next(s for s in stays if s["name"] == "Findable Hotel")
    assert backfilled["location"]["placeId"] == "has-photo"
    assert backfilled["location"]["imgRef"] == PHOTOS["has-photo"]


async def test_no_match_leaves_the_location_untouched(
    client: AsyncClient, db: AsyncSession, trip: Json, patch_google: None
) -> None:
    await client.post(
        f"/trips/{trip['id']}/stays",
        json={
            "name": "Unknown Place",
            "checkIn": "2026-05-14T15:00",
            "checkOut": "2026-05-15T11:00",
            "location": {"name": "Unknown Place"},
        },
    )
    checked, updated = await _backfill_stays(db)
    await db.commit()
    assert (checked, updated) == (1, 0)

    stays = (await client.get(f"/trips/{trip['id']}")).json()["stays"]
    location = next(s for s in stays if s["name"] == "Unknown Place")["location"]
    assert "placeId" not in location and "imgRef" not in location


async def test_a_location_that_already_has_a_photo_is_never_looked_up_again(
    client: AsyncClient, db: AsyncSession, trip: Json, patch_google: None
) -> None:
    await client.post(
        f"/trips/{trip['id']}/stays",
        json={
            "name": "Already has one",
            "checkIn": "2026-05-14T15:00",
            "checkOut": "2026-05-15T11:00",
            "location": {
                "name": "Already has one",
                "placeId": "has-photo",
                "imgRef": "https://existing",
            },
        },
    )
    # fake_fetch/fake_find_place_id would raise or return something else if
    # called on "has-photo" again — only the count matters here, since the
    # location is already fully backfilled and should be skipped outright.
    checked, updated = await _backfill_stays(db)
    await db.commit()
    assert (checked, updated) == (0, 0)

    stays = (await client.get(f"/trips/{trip['id']}")).json()["stays"]
    assert (
        next(s for s in stays if s["name"] == "Already has one")["location"]["imgRef"]
        == "https://existing"
    )


async def test_backfills_both_ends_of_a_travel_leg_independently(
    client: AsyncClient, db: AsyncSession, trip: Json, patch_google: None
) -> None:
    await client.post(
        f"/trips/{trip['id']}/travels",
        json={
            "title": "A -> B",
            "mode": "train",
            "from": {"name": "Findable A"},
            "to": {"name": "Unknown B"},
            "depart": "2026-05-14T09:00",
        },
    )
    checked, updated = await _backfill_travels(db)
    await db.commit()
    assert (checked, updated) == (2, 1)

    travels = (await client.get(f"/trips/{trip['id']}")).json()["travels"]
    leg = next(t for t in travels if t["title"] == "A -> B")
    assert leg["from"]["imgRef"] == PHOTOS["has-photo"]
    assert "imgRef" not in leg["to"]


async def test_backfills_an_activitys_place(
    client: AsyncClient, db: AsyncSession, trip: Json, patch_google: None
) -> None:
    await client.post(
        f"/trips/{trip['id']}/items",
        json={
            "date": "2026-05-11",
            "title": "Coffee",
            "location": {"name": "Coffee shop", "placeId": "has-photo"},
        },
    )
    checked, updated = await _backfill_items(db)
    await db.commit()
    assert (checked, updated) == (1, 1)

    updated_trip = (await client.get(f"/trips/{trip['id']}")).json()
    coffee = next(i for d in updated_trip["days"] for i in d["items"] if i["title"] == "Coffee")
    assert coffee["location"]["imgRef"] == PHOTOS["has-photo"]
