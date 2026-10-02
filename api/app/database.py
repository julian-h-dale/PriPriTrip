"""Async SQLAlchemy engine and session factory.

The async pattern is the constant here, not the specific database. SQLite
still goes through the async engine via aiosqlite.
"""

from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.settings import get_app_settings

_database_url = get_app_settings().database_url

# For file-based SQLite, make sure the parent directory exists.
if _database_url.startswith("sqlite") and ":///" in _database_url:
    db_path = _database_url.split(":///", 1)[1]
    if db_path and db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_async_engine(_database_url)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
