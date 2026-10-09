"""Shared pytest fixtures.

In-memory SQLite via the async driver with StaticPool — no external DB.
The current-user dependency is overridden so tests don't need real JWTs.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncGenerator

# Ensure the app can boot without a real .env during tests.
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import enable_sqlite_foreign_keys, get_db, get_session_factory
from app.main import create_app
from app.models import Base, UserRecord
from app.settings import get_app_settings
from app.users import current_active_user, get_jwt_strategy

test_engine = create_async_engine(
    "sqlite+aiosqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
enable_sqlite_foreign_keys(test_engine)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
def no_google(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests never call Google: no key (api/.env may have a real one). A
    test that wants a lookup fakes `google_places_server.nearby_place`."""
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "")


@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with TestSessionLocal() as session:
        yield session
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def test_user(db: AsyncSession) -> UserRecord:
    user = UserRecord(
        id=uuid.uuid4(),
        email="user@example.com",
        hashed_password="x",
        is_active=True,
        is_verified=True,
        name="Test User",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def client(db: AsyncSession, test_user: UserRecord) -> AsyncGenerator[AsyncClient, None]:
    app = create_app()

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_active_user] = lambda: test_user
    app.dependency_overrides[get_session_factory] = lambda: TestSessionLocal

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def admin_user(db: AsyncSession) -> UserRecord:
    user = UserRecord(
        id=uuid.uuid4(),
        email="admin@example.com",
        hashed_password="x",
        is_active=True,
        is_superuser=True,
        is_verified=True,
        name="Test Admin",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _token_client(db: AsyncSession, user: UserRecord | None) -> AsyncClient:
    """Client that exercises the real dependency chain via a JWT.

    Overriding `current_active_user` (as the `client` fixture does) is fine for
    ordinary feature/ownership tests, but it only covers the one exported
    callable — not `current_superuser`, nor the instances fastapi-users builds
    internally. Anything asserting *authorisation* (403-vs-401) must use a real
    token so it tests what it claims to.
    """
    app = create_app()

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    ac = AsyncClient(transport=transport, base_url="http://test")
    if user is not None:
        token = await get_jwt_strategy().write_token(user)
        scheme = "Bearer"
        ac.headers["Authorization"] = f"{scheme} {token}"
    return ac


@pytest_asyncio.fixture
async def token_client(
    db: AsyncSession, test_user: UserRecord
) -> AsyncGenerator[AsyncClient, None]:
    ac = await _token_client(db, test_user)
    async with ac:
        yield ac


@pytest_asyncio.fixture
async def admin_client(
    db: AsyncSession, admin_user: UserRecord
) -> AsyncGenerator[AsyncClient, None]:
    ac = await _token_client(db, admin_user)
    async with ac:
        yield ac


@pytest_asyncio.fixture
async def anon_client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    ac = await _token_client(db, None)
    async with ac:
        yield ac


# ---- a second and third person, for sharing and the journal ----


async def _user(db: AsyncSession, email: str) -> UserRecord:
    user = UserRecord(id=uuid.uuid4(), email=email, hashed_password="x", is_active=True)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class UserClient(AsyncClient):
    """A test client signed in as one account; `email` is that account's (for
    adding them to a trip)."""

    email: str


async def _client_for(db: AsyncSession, user: UserRecord) -> UserClient:
    app = create_app()

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_active_user] = lambda: user
    app.dependency_overrides[get_session_factory] = lambda: TestSessionLocal
    ac = UserClient(transport=ASGITransport(app=app), base_url="http://test")
    ac.email = user.email
    return ac


@pytest_asyncio.fixture
async def viewer_user(db: AsyncSession) -> UserRecord:
    return await _user(db, "pripri@example.com")


@pytest_asyncio.fixture
async def viewer(db: AsyncSession, viewer_user: UserRecord) -> AsyncGenerator[UserClient, None]:
    async with await _client_for(db, viewer_user) as ac:
        yield ac


@pytest_asyncio.fixture
async def stranger(db: AsyncSession) -> AsyncGenerator[UserClient, None]:
    async with await _client_for(db, await _user(db, "stranger@example.com")) as ac:
        yield ac


def if_match(version: int) -> dict[str, str]:
    """The If-Match header for changing an entry read at `version` (a day
    with no row yet is version 0; a freshly imported entry is version 1)."""
    return {"If-Match": f'"{version}"'}
