"""What the Pi backs up: every live photo's original, and every trip's journal.

The Pi (scripts/pi-backup/) pages through the photo list and downloads what
it doesn't have yet. Pages are ordered by (uploaded, id) — a total order, so a
page boundary can never skip or repeat a photo. The Pi asks again from a
little before its last cursor and skips files it already holds, so a photo
that committed out of order is still picked up.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import active
from app.models import Memory, Photo, Trip, UserRecord
from app.schemas import (
    BackupJournal,
    BackupMemory,
    BackupPhoto,
    BackupPhotoPage,
    MemoryLocation,
)

PAGE_SIZE = 500


class BadCursor(ValueError):
    pass


def display_name(user: UserRecord) -> str:
    return user.name or user.email.split("@")[0]


def encode_cursor(at: dt.datetime, photo_id: uuid.UUID) -> str:
    return f"{at.astimezone(dt.UTC).isoformat()}|{photo_id}"


def decode_cursor(cursor: str) -> tuple[dt.datetime, uuid.UUID]:
    """`<ISO instant>|<uuid>`. The Pi makes its own ("from an hour before")
    with the zero uuid."""
    try:
        at_text, id_text = cursor.split("|", 1)
        at = dt.datetime.fromisoformat(at_text)
        photo_id = uuid.UUID(id_text)
    except ValueError as exc:
        raise BadCursor(str(exc)) from None
    if at.tzinfo is None:
        raise BadCursor("the cursor's time needs an offset")
    return at.astimezone(dt.UTC), photo_id


def _local(memory: Memory) -> dt.datetime:
    try:
        return memory.created_at.astimezone(ZoneInfo(memory.zone))
    except (KeyError, ValueError):  # zones are checked on write; belt and braces
        return memory.created_at.astimezone(dt.UTC)


async def photo_page(
    db: AsyncSession, after: str | None = None, limit: int = PAGE_SIZE
) -> BackupPhotoPage:
    """Live photos (on live memories and trips) uploaded after the cursor."""
    query = (
        select(Photo, Memory, Trip, UserRecord)
        .join(Memory, Photo.memory_id == Memory.id)
        .join(Trip, Photo.trip_id == Trip.id)
        .join(UserRecord, Photo.user_id == UserRecord.id)
        .where(active(Photo), active(Memory), active(Trip))
        .order_by(Photo.created_at, Photo.id)
        .limit(limit + 1)
    )
    if after:
        at, photo_id = decode_cursor(after)
        query = query.where(
            or_(Photo.created_at > at, and_(Photo.created_at == at, Photo.id > photo_id))
        )
    rows = (await db.execute(query)).tuples().all()
    more = len(rows) > limit
    rows = rows[:limit]
    photos = []
    for photo, memory, trip, author in rows:
        local = _local(memory)
        photos.append(
            BackupPhoto(
                id=photo.id,
                trip_id=trip.id,
                trip_name=trip.name,
                memory_id=memory.id,
                author=display_name(author),
                taken_at=memory.created_at,
                zone=memory.zone,
                local_date=local.date(),
                local_time=local.strftime("%H%M"),
                format=photo.original_format,
                bytes=photo.original_bytes,
                uploaded_at=photo.created_at,
                original_url=f"/photos/{photo.id}/original",
            )
        )
    last = rows[-1][0] if rows else None
    return BackupPhotoPage(
        photos=photos,
        next=encode_cursor(last.created_at, last.id) if more and last is not None else None,
    )


async def journals(db: AsyncSession) -> list[BackupJournal]:
    """Every live trip that has a journal, with all its live memories (public
    or not), oldest first, and which photos belong to each."""
    rows = (
        (
            await db.execute(
                select(Memory, Trip, UserRecord)
                .join(Trip, Memory.trip_id == Trip.id)
                .join(UserRecord, Memory.user_id == UserRecord.id)
                .where(active(Memory), active(Trip))
                .order_by(Trip.start_date, Trip.id, Memory.created_at, Memory.id)
            )
        )
        .tuples()
        .all()
    )
    photo_rows = await db.execute(
        select(Photo.memory_id, Photo.id)
        .where(Photo.memory_id.in_([m.id for m, _, _ in rows]), active(Photo))
        .order_by(Photo.created_at, Photo.id)
    )
    photo_ids: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for memory_id, photo_id in photo_rows.tuples():
        photo_ids[memory_id].append(photo_id)

    by_trip: dict[uuid.UUID, BackupJournal] = {}
    for memory, trip, author in rows:
        journal = by_trip.get(trip.id)
        if journal is None:
            journal = by_trip[trip.id] = BackupJournal(
                trip_id=trip.id,
                trip_name=trip.name,
                start_date=trip.start_date,
                end_date=trip.end_date,
                memories=[],
            )
        journal.memories.append(
            BackupMemory(
                id=memory.id,
                author=display_name(author),
                created_at=memory.created_at,
                zone=memory.zone,
                updated_at=memory.updated_at,
                text=memory.text,
                is_public=memory.is_public,
                location=(
                    MemoryLocation(lat=memory.lat, lng=memory.lng, accuracy=memory.accuracy)
                    if memory.lat is not None and memory.lng is not None
                    else None
                ),
                photo_ids=photo_ids.get(memory.id, []),
            )
        )
    return list(by_trip.values())
