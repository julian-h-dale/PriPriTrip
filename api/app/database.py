from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.settings import get_settings


def get_database_url() -> str:
    url = get_settings().database_url
    # Accept plain postgresql:// URLs and upgrade them for asyncpg
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


class Base(DeclarativeBase):
    # Fetch server-side defaults (created_at/updated_at, which are NOW()) as part
    # of the INSERT, via PostgreSQL's RETURNING.
    #
    # Without this SQLAlchemy leaves those columns *unloaded* on a freshly
    # inserted object and fetches them on first access. That access is usually a
    # sync one — Pydantic serialising the row — and a lazy load from sync code
    # under asyncio raises MissingGreenlet. It only bites when one session both
    # inserts a row and then renders it, which is exactly what a chat turn does
    # when the model changes the trip's dates: reconcile_trip_days inserts the
    # new day rows, and the same turn serialises them on the way out.
    __mapper_args__ = {"eager_defaults": True}


engine = create_async_engine(get_database_url(), echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
