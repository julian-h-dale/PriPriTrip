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
import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import active
from app.models import Memory, UserRecord
from app.schemas import MemoryLocation, MemoryRead, PhotoRead
from app.services.photos import photos_by_memory

FUTURE_TOLERANCE = dt.timedelta(minutes=10)


def _read(
    memory: Memory,
    author: UserRecord,
    viewer_id: uuid.UUID,
    photos: list[PhotoRead] | None = None,
) -> MemoryRead:
    return MemoryRead(
        id=memory.id,
        text=memory.text,
        zone=memory.zone,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
        received_at=memory.received_at,
        location=(
            MemoryLocation(lat=memory.lat, lng=memory.lng, accuracy=memory.accuracy)
            if memory.lat is not None and memory.lng is not None
            else None
        ),
        photos=photos or [],
        author_email=author.email,
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
    return [_read(memory, author, viewer_id, photos.get(memory.id)) for memory, author in rows]


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
                return Created(
                    _read(existing, author, author.id, photos.get(existing.id)), new=False
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
    return Created(_read(memory, author, author.id), new=True)


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
    if is_public is not None:
        memory.is_public = is_public
    memory.updated_at = dt.datetime.now(dt.UTC)
    await db.commit()
    await db.refresh(memory)
    photos = await photos_by_memory(db, [memory.id])
    return _read(memory, author, author.id, photos.get(memory.id))


async def delete_memory(db: AsyncSession, memory: Memory) -> None:
    memory.is_deleted = True
    memory.deleted_at = dt.datetime.now(dt.UTC)
    await db.commit()
