"""The trip journal: memories written by the people on a trip.

Memories can be written offline, so the phone makes each one's id and
`created_at` (UTC, when Save was tapped) and the journal orders by that,
then id. Phone clocks are NTP-synced and trusted, with one guard: a time
more than `FUTURE_TOLERANCE` ahead of the server is clamped to when the
memory arrived (rejecting it would strand it in the phone's outbox).
Creating is idempotent on the id, so a retried upload can't duplicate.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import google_places_server
from app.dependencies import active
from app.models import Memory, Trip, TripMember, UserRecord
from app.schemas import MemoryLocation, MemoryLocationRead, MemoryRead, PhotoRead
from app.services.photos import photos_by_memory

log = logging.getLogger(__name__)

FUTURE_TOLERANCE = dt.timedelta(minutes=10)


async def author_ranks(db: AsyncSession, trip_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Everyone's place on the trip, for their color in the journal: the
    owner 0, then members in the order they first joined (people who left
    keep theirs, so colors never shift)."""
    owner_id = await db.scalar(select(Trip.user_id).where(Trip.id == trip_id))
    ranks: dict[uuid.UUID, int] = {owner_id: 0} if owner_id else {}
    member_ids = await db.scalars(
        select(TripMember.user_id)
        .where(TripMember.trip_id == trip_id)
        .order_by(TripMember.created_at, TripMember.id)
    )
    for user_id in member_ids:
        ranks.setdefault(user_id, len(ranks))
    return ranks


def _read(
    memory: Memory,
    author: UserRecord,
    viewer_id: uuid.UUID,
    photos: list[PhotoRead] | None = None,
    ranks: dict[uuid.UUID, int] | None = None,
) -> MemoryRead:
    return MemoryRead(
        id=memory.id,
        text=memory.text,
        zone=memory.zone,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
        received_at=memory.received_at,
        location=(
            MemoryLocationRead(
                lat=memory.lat,
                lng=memory.lng,
                accuracy=memory.accuracy,
                place_name=memory.place_name,
                place_area=memory.place_area,
            )
            if memory.lat is not None and memory.lng is not None
            else None
        ),
        photos=photos or [],
        author_email=author.email,
        author_name=author.name,
        author_rank=(ranks or {}).get(author.id, 0),
        mine=memory.user_id == viewer_id,
        is_public=memory.is_public,
    )


def visible_to(role: str, user_id: uuid.UUID) -> ColumnElement[bool]:
    """Which memories a person on the trip may see: the owner and editors see
    every one; a viewer sees public ones (and any they wrote themselves, from
    before viewers stopped writing). The one place this rule lives."""
    if role == "viewer":
        return or_(Memory.is_public.is_(True), Memory.user_id == user_id)
    return true()


def can_see(memory: Memory, role: str, user_id: uuid.UUID) -> bool:
    """`visible_to` for one loaded memory."""
    return role != "viewer" or memory.is_public or memory.user_id == user_id


async def list_memories(
    db: AsyncSession, trip_id: uuid.UUID, viewer_id: uuid.UUID, role: str = "owner"
) -> list[MemoryRead]:
    """Every live memory on the trip the caller may see, oldest first."""
    result = await db.execute(
        select(Memory, UserRecord)
        .join(UserRecord, Memory.user_id == UserRecord.id)
        .where(Memory.trip_id == trip_id, active(Memory), visible_to(role, viewer_id))
        .order_by(Memory.created_at, Memory.id)
    )
    rows = result.tuples().all()
    photos = await photos_by_memory(db, [memory.id for memory, _ in rows])
    ranks = await author_ranks(db, trip_id)
    return [
        _read(memory, author, viewer_id, photos.get(memory.id), ranks) for memory, author in rows
    ]


class MemoryIdTaken(Exception):
    """The id is already another memory's (someone else's, another trip's,
    or one that was deleted)."""


@dataclass
class Created:
    memory: MemoryRead
    new: bool  # False when this id was already saved (a retry)


def ordering_time(sent: dt.datetime | None, received: dt.datetime) -> dt.datetime:
    """When the memory happened, for ordering: the phone's time, unless it's
    missing or implausibly far in the future."""
    if sent is None:
        return received
    sent = sent.astimezone(dt.UTC)
    return received if sent > received + FUTURE_TOLERANCE else sent


async def create_memory(
    db: AsyncSession,
    trip_id: uuid.UUID,
    author: UserRecord,
    text: str,
    zone: str,
    *,
    memory_id: uuid.UUID | None = None,
    created_at: dt.datetime | None = None,
    location: MemoryLocation | None = None,
    is_public: bool = False,
) -> Created:
    if memory_id is not None:
        existing = await db.get(Memory, memory_id)
        if existing is not None:
            # A retry of the same upload: hand back what was saved.
            if (
                existing.user_id == author.id
                and existing.trip_id == trip_id
                and not existing.is_deleted
            ):
                photos = await photos_by_memory(db, [existing.id])
                ranks = await author_ranks(db, trip_id)
                return Created(
                    _read(existing, author, author.id, photos.get(existing.id), ranks),
                    new=False,
                )
            raise MemoryIdTaken()
    received = dt.datetime.now(dt.UTC)
    memory = Memory(
        id=memory_id or uuid.uuid4(),
        trip_id=trip_id,
        user_id=author.id,
        text=text,
        zone=zone,
        created_at=ordering_time(created_at, received),
        received_at=received,
        lat=location.lat if location else None,
        lng=location.lng if location else None,
        accuracy=location.accuracy if location else None,
        is_public=is_public,
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)
    ranks = await author_ranks(db, trip_id)
    return Created(_read(memory, author, author.id, ranks=ranks), new=True)


async def update_memory(
    db: AsyncSession,
    memory: Memory,
    author: UserRecord,
    text: str,
    *,
    clear_location: bool = False,
    is_public: bool | None = None,
) -> MemoryRead:
    """New words (and optionally no location); `created_at` (and so its place
    in the journal) is unchanged. A location can be removed, never added
    later — it records where the phone was when the memory was written."""
    memory.text = text
    if clear_location:
        memory.lat = memory.lng = memory.accuracy = None
        memory.place_name = memory.place_area = None
    if is_public is not None:
        memory.is_public = is_public
    memory.updated_at = dt.datetime.now(dt.UTC)
    await db.commit()
    await db.refresh(memory)
    photos = await photos_by_memory(db, [memory.id])
    ranks = await author_ranks(db, memory.trip_id)
    return _read(memory, author, author.id, photos.get(memory.id), ranks)


async def delete_memory(db: AsyncSession, memory: Memory) -> None:
    memory.is_deleted = True
    memory.deleted_at = dt.datetime.now(dt.UTC)
    await db.commit()


# How far to look for a place to name: the phone's own uncertainty, kept
# between these (a café 300 m away is a guess, not where you were).
PLACE_RADIUS_MIN_M = 25.0
PLACE_RADIUS_MAX_M = 150.0
PLACE_RADIUS_DEFAULT_M = 50.0


def place_radius(accuracy: float | None) -> float:
    radius = PLACE_RADIUS_DEFAULT_M if accuracy is None else accuracy
    return min(PLACE_RADIUS_MAX_M, max(PLACE_RADIUS_MIN_M, radius))


async def name_place(db: AsyncSession, memory: Memory) -> bool:
    """Look up what's where `memory` was written and store it. Best effort:
    False (and nothing stored) when there's no location or no answer."""
    if memory.lat is None or memory.lng is None:
        return False
    lat, lng = memory.lat, memory.lng
    found = await google_places_server.nearby_place(lat, lng, place_radius(memory.accuracy))
    if found is None:
        return False
    await db.refresh(memory)
    if memory.lat != lat or memory.lng != lng:
        return False  # the location was removed while we looked
    memory.place_name = found.name
    memory.place_area = found.area
    await db.commit()
    return True


async def name_place_later(
    session_factory: async_sessionmaker[AsyncSession], memory_id: uuid.UUID
) -> None:
    """`name_place` as a background task, after the save has been answered,
    in its own session. A failure is logged, never raised."""
    try:
        async with session_factory() as db:
            memory = await db.get(Memory, memory_id)
            if memory is not None and not memory.is_deleted:
                await name_place(db, memory)
    except Exception:
        log.exception("Couldn't name the place for memory %s", memory_id)
