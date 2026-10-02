"""Idempotent seed script.

Creates two users from env-driven credentials (a general test user and a
test admin) plus a little sample data, so a fresh clone has something to
log in with and the UI isn't empty on first run.

Run:  python -m app.seed   (or: make seed)
Safe to run repeatedly.
"""

from __future__ import annotations

import asyncio
import contextlib

from fastapi_users.exceptions import UserAlreadyExists
from sqlalchemy import select

from app.database import AsyncSessionLocal, engine
from app.models import Base, Thing, UserRecord
from app.schemas import UserCreate
from app.settings import get_app_settings
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
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(UserRecord).filter_by(email=settings.seed_user_email))
        user = result.scalar_one_or_none()
        if user is None:
            return
        # Replant, don't append: drop this user's seeded rows and rebuild them
        # so repeat runs land on a known state. (Seed templates/config, never
        # generated history — derived records should come from using the app.)
        existing = await session.execute(select(Thing).filter_by(user_id=user.id))
        for thing in existing.scalars().all():
            await session.delete(thing)
        session.add_all(
            [
                Thing(user_id=user.id, title="First thing", notes="Seeded example row."),
                Thing(user_id=user.id, title="Second thing", notes="Edit or delete me."),
            ]
        )
        await session.commit()
        print("  replanted sample things")


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
