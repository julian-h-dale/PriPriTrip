"""The trip journal: memories written by the people on a trip.

Ordering is by the server's UTC `created_at` (then id), never by anything a
phone sends — so the journal reads in the order things were written, even
across time zones and phones with wrong clocks.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import active
from app.models import Memory, UserRecord
from app.schemas import MemoryRead


def _read(memory: Memory, author: UserRecord, viewer_id: uuid.UUID) -> MemoryRead:
    return MemoryRead(
        id=memory.id,
        text=memory.text,
        zone=memory.zone,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
        author_email=author.email,
        mine=memory.user_id == viewer_id,
    )


async def list_memories(
    db: AsyncSession, trip_id: uuid.UUID, viewer_id: uuid.UUID
) -> list[MemoryRead]:
    """Every live memory on the trip, everyone's, oldest first."""
    result = await db.execute(
        select(Memory, UserRecord)
        .join(UserRecord, Memory.user_id == UserRecord.id)
        .where(Memory.trip_id == trip_id, active(Memory))
        .order_by(Memory.created_at, Memory.id)
    )
    return [_read(memory, author, viewer_id) for memory, author in result.tuples().all()]


async def create_memory(
    db: AsyncSession, trip_id: uuid.UUID, author: UserRecord, text: str, zone: str
) -> MemoryRead:
    memory = Memory(trip_id=trip_id, user_id=author.id, text=text, zone=zone)
    db.add(memory)
    await db.commit()
    await db.refresh(memory)
    return _read(memory, author, author.id)


async def update_memory(
    db: AsyncSession, memory: Memory, author: UserRecord, text: str
) -> MemoryRead:
    """New words; `created_at` (and so its place in the journal) is unchanged."""
    memory.text = text
    memory.updated_at = dt.datetime.now(dt.UTC)
    await db.commit()
    await db.refresh(memory)
    return _read(memory, author, author.id)


async def delete_memory(db: AsyncSession, memory: Memory) -> None:
    memory.is_deleted = True
    memory.deleted_at = dt.datetime.now(dt.UTC)
    await db.commit()
