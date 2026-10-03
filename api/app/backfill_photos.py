"""Backfill LocationDoc.imgRef for existing stays, travels and activities
that don't have a photo yet.

Run:  python -m app.backfill_photos   (or: make backfill-photos)

Two cases, both best-effort and idempotent — a failed or empty lookup is
skipped, not an error, and anything that already has a photo is left alone
(safe to re-run, e.g. after Google adds a photo to a place that had none):

- A location with a Google placeId (picked from search in the UI) — look up
  its photo directly.
- A location with no placeId (typed by hand, or imported — e.g. with
  coordinates from a free geocoder rather than Google) — first resolve it to
  a place via a Places text search on its name + address/city, then look up
  that place's photo. A generic or ambiguous name can match the wrong place;
  nothing here double-checks the match, so spot-check anything that looked
  risky in the printed log.

Deliberately a one-off script, not wired into POST /trips/import — this app
otherwise never calls Google from the server, and an import shouldn't gain a
live dependency on Google being reachable. Run this by hand after an import
if you want photos backfilled.
"""

from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.google_places_server import fetch_first_photo_url, find_place_id
from app.models import Item, Stay, Travel

# A small, polite delay between Google calls so a trip's worth of lookups
# doesn't fire all at once.
DELAY_SECONDS = 0.2


def _search_query(location: dict[str, Any]) -> str:
    name = location.get("name", "")
    if location.get("address"):
        return f"{name}, {location['address']}"
    if location.get("city"):
        return f"{name}, {location['city']}"
    return name


async def _resolve_photo(location: dict[str, Any]) -> dict[str, Any] | None:
    """The location with imgRef filled in (and placeId too, if it had to be
    resolved by name), or None if nothing was found to add."""
    label = location.get("name", "?")
    place_id = location.get("placeId")
    resolved_id = False

    if not place_id:
        query = _search_query(location)
        place_id = await find_place_id(query)
        if not place_id:
            print(f"  {label}: no Places match for {query!r}")
            return None
        resolved_id = True

    photo_url = await fetch_first_photo_url(place_id)
    await asyncio.sleep(DELAY_SECONDS)
    if not photo_url:
        print(f"  {label}: {'matched a place but ' if resolved_id else ''}no photo")
        return None

    print(f"  {label}: {'matched a place, photo found' if resolved_id else 'photo found'}")
    updated = {**location, "imgRef": photo_url}
    if resolved_id:
        updated["placeId"] = place_id
    return updated


async def _backfill_stays(session: AsyncSession) -> tuple[int, int]:
    result = await session.execute(
        select(Stay).where(Stay.is_deleted.is_(False), Stay.location.isnot(None))
    )
    checked = updated = 0
    for stay in result.scalars().all():
        location = stay.location
        if location is None or location.get("imgRef"):
            continue
        checked += 1
        new_location = await _resolve_photo(location)
        if new_location:
            stay.location = new_location
            updated += 1
    return checked, updated


async def _backfill_travels(session: AsyncSession) -> tuple[int, int]:
    result = await session.execute(select(Travel).where(Travel.is_deleted.is_(False)))
    checked = updated = 0
    for travel in result.scalars().all():
        from_loc = travel.from_location
        if from_loc is not None and not from_loc.get("imgRef"):
            checked += 1
            new_location = await _resolve_photo(from_loc)
            if new_location:
                travel.from_location = new_location
                updated += 1

        to_loc = travel.to_location
        if to_loc is not None and not to_loc.get("imgRef"):
            checked += 1
            new_location = await _resolve_photo(to_loc)
            if new_location:
                travel.to_location = new_location
                updated += 1
    return checked, updated


async def _backfill_items(session: AsyncSession) -> tuple[int, int]:
    result = await session.execute(
        select(Item).where(Item.is_deleted.is_(False), Item.location.isnot(None))
    )
    checked = updated = 0
    for item in result.scalars().all():
        location = item.location
        if location is None or location.get("imgRef"):
            continue
        checked += 1
        new_location = await _resolve_photo(location)
        if new_location:
            item.location = new_location
            updated += 1
    return checked, updated


async def main() -> None:
    async with AsyncSessionLocal() as session:
        stay_counts = await _backfill_stays(session)
        travel_counts = await _backfill_travels(session)
        item_counts = await _backfill_items(session)
        await session.commit()

    checked = stay_counts[0] + travel_counts[0] + item_counts[0]
    updated = stay_counts[1] + travel_counts[1] + item_counts[1]
    print(f"Done. {updated}/{checked} locations got a photo.")


if __name__ == "__main__":
    asyncio.run(main())
