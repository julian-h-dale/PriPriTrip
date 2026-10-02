"""Business logic for the Thing vertical slice, kept out of route handlers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import active
from app.models import Thing
from app.schemas import ThingCreate, ThingUpdate


async def list_things(db: AsyncSession, user_id: uuid.UUID) -> list[Thing]:
    result = await db.execute(
        select(Thing)
        .where(Thing.user_id == user_id, active(Thing))
        .order_by(Thing.created_at.desc())
    )
    return list(result.scalars().all())


async def create_thing(db: AsyncSession, user_id: uuid.UUID, data: ThingCreate) -> Thing:
    thing = Thing(user_id=user_id, title=data.title, notes=data.notes)
    db.add(thing)
    await db.commit()
    await db.refresh(thing)
    return thing


async def update_thing(db: AsyncSession, thing: Thing, data: ThingUpdate) -> Thing:
    if data.title is not None:
        thing.title = data.title
    if data.notes is not None:
        thing.notes = data.notes
    await db.commit()
    await db.refresh(thing)
    return thing


async def soft_delete_thing(db: AsyncSession, thing: Thing) -> None:
    thing.is_deleted = True
    thing.deleted_at = datetime.now(UTC)
    await db.commit()
