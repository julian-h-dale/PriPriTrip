"""Registration against the real UserManager and a real users row.

`tests/test_auth.py` drives the endpoints with a *fake* manager, which is right
for testing the routing and the error mapping — but it cannot see what
fastapi-users actually does to the payload on the way through. And what it does
is strip things.

`UserManager.create()` used to be overridden to set `is_verified=True` on the
incoming UserCreate. Both registration routes call `create(safe=True)`, and
`safe=True` makes fastapi-users drop is_verified / is_active / is_superuser —
deliberately, so a stranger POSTing to /auth/register cannot promote themselves.
So the value was silently discarded and every registered user landed
**unverified**, while the module docstring claimed the opposite.

Harmless right up until something asks for `current_user(verified=True)`, at which
point every existing user is locked out at once. These tests exist so the dead
code cannot creep back. See docs/auth_test_analysis.md §3.1.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models import UserRecord
from app.users import get_jwt_strategy

pytestmark = pytest.mark.asyncio


def _body(email: str | None = None, password: str = "honeymoon") -> dict:
    return {
        "email": email or f"reg-{uuid.uuid4().hex[:8]}@example.com",
        "password": password,
        "name": "New User",
    }


async def _row(db, email: str) -> UserRecord | None:
    result = await db.execute(select(UserRecord).where(UserRecord.email == email))
    return result.scalar_one_or_none()


class TestRegistrationProducesAVerifiedUser:
    async def test_the_row_is_actually_verified(self, anon_client, db):
        body = _body()

        resp = await anon_client.post("/auth/register/session", json=body)
        assert resp.status_code == 200

        user = await _row(db, body["email"])
        assert user is not None
        assert user.is_verified is True  # was False — the override was dead code

    async def test_the_stock_register_route_agrees(self, anon_client, db):
        """Two routes create users. Both must land in the same state."""
        body = _body()

        resp = await anon_client.post("/auth/register", json=body)
        assert resp.status_code == 201

        user = await _row(db, body["email"])
        assert user.is_verified is True

    async def test_a_stranger_still_cannot_make_themselves_a_superuser(self, anon_client, db):
        """The reason safe=True strips those fields in the first place.

        Verifying after creation must not reopen the hole it was closing.
        """
        body = _body()
        body["is_superuser"] = True
        body["is_active"] = False

        resp = await anon_client.post("/auth/register/session", json=body)
        assert resp.status_code == 200

        user = await _row(db, body["email"])
        assert user.is_superuser is False
        assert user.is_active is True
        assert user.is_verified is True  # ...and verification still happened

    async def test_a_weak_password_creates_nobody(self, anon_client, db):
        body = _body(password="short")

        resp = await anon_client.post("/auth/register/session", json=body)

        assert resp.status_code == 400
        assert await _row(db, body["email"]) is None

    async def test_the_new_user_can_immediately_sign_in(self, anon_client, db):
        body = _body()
        await anon_client.post("/auth/register/session", json=body)

        resp = await anon_client.post(
            "/auth/session",
            json={"email": body["email"], "password": body["password"]},
        )

        assert resp.status_code == 200
        assert len(resp.json()["token"].split(".")) == 3


class TestTokenLifetime:
    def test_a_leaked_token_expires_in_a_week_not_a_month(self):
        """A JWT cannot be revoked, so the lifetime IS the blast radius.

        /auth/logout is a no-op with a stateless strategy — the token stays valid
        until it expires. Pinned so nobody widens it back without meaning to.
        """
        assert get_jwt_strategy().lifetime_seconds == 60 * 60 * 24 * 7
