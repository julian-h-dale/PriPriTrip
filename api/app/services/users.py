"""Business logic for user administration, kept out of route handlers."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserRecord


async def list_users(db: AsyncSession) -> list[UserRecord]:
    result = await db.execute(select(UserRecord).order_by(UserRecord.email))
    return list(result.scalars().all())
