"""Real-database sessions for the eval harness (review.md 1C-3).

Evals used to run against a fake session, which meant a scenario could "pass"
on a write the real schema would have rejected. They now run against the same
throwaway Postgres database the tests use — each scenario in its own
transaction, rolled back afterwards, so nothing accumulates.
"""

from __future__ import annotations

import contextlib
import os
import uuid
from urllib.parse import urlparse, urlunparse

import asyncpg
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base
from app.models import UserRecord

DEFAULT_EVAL_DB_URL = "postgresql+asyncpg://postgres:postgres@localhost:5433/pripritrip_evals"
EVAL_DATABASE_URL = os.environ.get("EVAL_DATABASE_URL", DEFAULT_EVAL_DB_URL)

_engine = None
_user_id: str | None = None


def _admin_dsn(url: str) -> tuple[str, str]:
    parsed = urlparse(url.replace("postgresql+asyncpg://", "postgresql://"))
    return urlunparse(parsed._replace(path="/postgres")), parsed.path.lstrip("/")


async def setup() -> None:
    """Create the eval database and its schema, plus the user scenarios hang off."""
    global _engine, _user_id

    admin_dsn, db_name = _admin_dsn(EVAL_DATABASE_URL)
    assert db_name != "pripritrip", "refusing to run evals against the dev database"

    try:
        conn = await asyncpg.connect(admin_dsn)
    except (OSError, asyncpg.PostgresError) as exc:
        raise SystemExit(
            f"Cannot reach PostgreSQL at {admin_dsn} ({exc}).\n"
            "Evals now run against a real database. Start it with:\n"
            "    cd api && docker compose up -d"
        ) from None
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await conn.close()

    _engine = create_async_engine(EVAL_DATABASE_URL)
    async with _engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    _user_id = str(uuid.uuid4())
    async with AsyncSession(_engine, expire_on_commit=False) as session:
        session.add(
            UserRecord(
                id=uuid.UUID(_user_id),
                email=f"evals-{uuid.uuid4().hex[:8]}@example.com",
                hashed_password="not-a-real-hash",
                is_active=True,
                is_superuser=False,
                is_verified=True,
                name="Eval User",
            )
        )
        await session.commit()


async def teardown() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


def user_id() -> str:
    assert _user_id is not None, "call setup() first"
    return _user_id


@contextlib.asynccontextmanager
async def scenario_session():
    """A session whose writes are rolled back when the scenario finishes."""
    assert _engine is not None, "call setup() first"
    connection = await _engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        await session.close()
        await transaction.rollback()
        await connection.close()
