"""Test fixtures backed by a real PostgreSQL database (review.md 1C-3).

The tests used to run against hand-rolled fake sessions that ignored WHERE
clauses and could not execute bulk UPDATEs. They were quietly diverging from
production: a query filtered by `request_id` returned every row, a soft-delete
cascade had to be faked, and `relationship()`/`selectinload` could not be used
at all because a fake session cannot populate them. So every DB test now runs
against the real schema, with real constraints and real SQL.

Isolation: each test runs inside a transaction that is rolled back afterwards.
The session joins it via savepoints, so the endpoints' own `commit()` calls
behave exactly as they do in production while still being undone at the end.
No truncation, no leakage between tests.

The database is separate from your dev one — `pripritrip_test` on the same
docker Postgres — and is recreated at the start of each run. Override with
TEST_DATABASE_URL.
"""

import os
import sys
from urllib.parse import urlparse, urlunparse
import uuid

import pytest
import pytest_asyncio

# Ensure the api/ directory is on sys.path so `app.*` imports resolve
# whether pytest is run from api/ or from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# The app fails fast at boot without a JWT secret; tests don't need a real one.
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import asyncpg  # noqa: E402
from fastapi import HTTPException, Request  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

from app.auth import require_auth  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import UserRecord  # noqa: E402

DEFAULT_TEST_DB_URL = "postgresql+asyncpg://postgres:postgres@localhost:5433/pripritrip_test"
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB_URL)


def _admin_dsn(url: str) -> tuple[str, str]:
    """(dsn for the `postgres` maintenance db, name of the test db)."""
    parsed = urlparse(url.replace("postgresql+asyncpg://", "postgresql://"))
    db_name = parsed.path.lstrip("/")
    admin = urlunparse(parsed._replace(path="/postgres"))
    return admin, db_name


async def _recreate_test_database() -> None:
    admin_dsn, db_name = _admin_dsn(TEST_DATABASE_URL)
    # Guard rail: never point the suite at the dev database.
    assert db_name != "pripritrip", "refusing to run tests against the dev database"
    try:
        conn = await asyncpg.connect(admin_dsn)
    except (OSError, asyncpg.PostgresError) as exc:
        pytest.exit(
            f"Cannot reach PostgreSQL at {admin_dsn} ({exc}).\n"
            "The suite needs a real database. Start it with:\n"
            "    cd api && docker compose up -d\n"
            "or point TEST_DATABASE_URL somewhere else.",
            returncode=1,
        )
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session")
async def engine():
    await _recreate_test_database()
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(engine):
    """A session in a transaction that is rolled back when the test ends."""
    connection = await engine.connect()
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


async def _make_user(db, prefix: str) -> UserRecord:
    record = UserRecord(
        id=uuid.uuid4(),
        email=f"{prefix}-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="not-a-real-hash",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        name="Test User",
    )
    db.add(record)
    # Committed, not just flushed: a user is pre-existing state as far as any
    # request is concerned, so an endpoint rolling back its own transaction
    # must not erase them.
    await db.commit()
    # Detach it with its values already loaded. A rollback inside a request
    # expires everything still attached to the session, and the app reads
    # `user.id` from async code — an implicit refresh there would blow up with
    # MissingGreenlet. The real app authenticates against a committed row it
    # never re-reads, so this matches production.
    db.expunge(record)
    return record


@pytest_asyncio.fixture
async def user(db) -> UserRecord:
    """A real row in `users` — trips carry a foreign key to it."""
    return await _make_user(db, "tester")


@pytest_asyncio.fixture
async def other_user(db) -> UserRecord:
    """A second user, for ownership checks."""
    return await _make_user(db, "other")


_ANON_HEADER = "x-test-anonymous"


def _install_overrides(db, user: UserRecord) -> None:
    """Point the app at the test session, and make auth *request*-scoped.

    Both client fixtures install exactly the same overrides, which is what makes
    them safe to use in the same test. They mutate one global
    `app.dependency_overrides` dict, so a fixture that expressed "anonymous" by
    *removing* the auth override would simply be undone by whichever fixture
    pytest happened to build second — and `anon_client` would silently be signed
    in. It was: an anonymous DELETE of a trip came back 204.

    So signed-out is expressed per request, by a header, rather than by global
    state that another fixture can stomp.
    """

    def _db():
        return db

    def _auth(request: Request) -> UserRecord:
        if request.headers.get(_ANON_HEADER):
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[require_auth] = _auth


@pytest_asyncio.fixture
async def client(db, user):
    """HTTP client wired to the test session, authenticated as `user`."""
    _install_overrides(db, user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def anon_client(db, user):
    """Signed out — but still on the test database.

    `get_db` is still overridden. Without it an anonymous request falls through
    to the app's own engine and talks to the *dev* database, which went unnoticed
    for as long as this fixture was only used for 401 checks that never reached a
    query. The first genuinely public endpoint that reads data
    (`GET /shared/{token}`) found it immediately.
    """
    _install_overrides(db, user)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={_ANON_HEADER: "1"},
    ) as http:
        yield http
    app.dependency_overrides.clear()
