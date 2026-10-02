"""Idempotent seed script.

Creates two users from env-driven credentials (a general test user and a
test admin) plus the sample trip for the test user, so a fresh clone has
something to log in with and the UI isn't empty on first run.

Run:  python -m app.seed   (or: make seed)
Safe to run repeatedly.
"""

from __future__ import annotations

import asyncio
import contextlib

from fastapi_users.exceptions import UserAlreadyExists
from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, engine
from app.models import Base, Day, Item, Stay, Travel, Trip, UserRecord
from app.sample_data import load_sample_trip
from app.schemas import UserCreate
from app.services.trips import import_trip
from app.settings import get_app_settings
from app.trip_document import validate_trip_document
from app.users import get_user_db, get_user_manager

get_user_db_ctx = contextlib.asynccontextmanager(get_user_db)
get_user_manager_ctx = contextlib.asynccontextmanager(get_user_manager)


async def _create_user(email: str, password: str, *, is_superuser: bool, name: str) -> None:
    async with AsyncSessionLocal() as session:
        async with get_user_db_ctx(session) as user_db:
            async with get_user_manager_ctx(user_db) as user_manager:
                try:
                    await user_manager.create(
                        UserCreate(
                            email=email,
                            password=password,
                            is_superuser=is_superuser,
                            is_verified=True,
                            name=name,
                        )
                    )
                    print(f"  created {'admin' if is_superuser else 'user'}: {email}")
                except UserAlreadyExists:
                    print(f"  exists  {'admin' if is_superuser else 'user'}: {email}")


async def _seed_sample_data() -> None:
    settings = get_app_settings()
    doc = validate_trip_document(load_sample_trip())
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(UserRecord).filter_by(email=settings.seed_user_email))
        user = result.scalar_one_or_none()
        if user is None:
            return
        # Replant, don't append: hard-delete this user's earlier copies of the
        # sample trip (and only those) so repeat runs land on a known state.
        old = select(Trip.id).where(Trip.user_id == user.id, Trip.name == doc.name)
        old_days = select(Day.id).where(Day.trip_id.in_(old))
        await session.execute(delete(Item).where(Item.day_id.in_(old_days)))
        for child in (Day, Stay, Travel):
            await session.execute(delete(child).where(child.trip_id.in_(old)))
        await session.execute(delete(Trip).where(Trip.id.in_(old)))
        await session.commit()

        await import_trip(session, user.id, doc)
        print(f"  replanted sample trip: {doc.name}")


async def main() -> None:
    settings = get_app_settings()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    print("Seeding users...")
    await _create_user(
        settings.seed_user_email, settings.seed_user_password, is_superuser=False, name="Test User"
    )
    await _create_user(
        settings.seed_admin_email,
        settings.seed_admin_password,
        is_superuser=True,
        name="Test Admin",
    )
    await _seed_sample_data()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
