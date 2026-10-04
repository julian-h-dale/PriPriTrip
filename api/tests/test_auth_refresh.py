"""POST /auth/refresh: a still-valid token buys a fresh one (a sliding sign-in).

Authorisation tests, so they use real tokens (`token_client`), not the
`current_active_user` override.
"""

from __future__ import annotations

import time

import jwt
from fastapi_users.jwt import generate_jwt
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserRecord
from app.settings import get_auth_settings


def _claims(token: str) -> dict:
    return jwt.decode(token, options={"verify_signature": False})


def _token(user: UserRecord, lifetime_seconds: int) -> str:
    data = {"sub": str(user.id), "aud": ["fastapi-users:auth"]}
    return generate_jwt(data, get_auth_settings().jwt_secret, lifetime_seconds)


async def test_refresh_gives_a_new_token_with_a_later_expiry(
    token_client: AsyncClient, test_user: UserRecord
) -> None:
    old = _token(test_user, 3600)  # an hour left
    resp = await token_client.post("/auth/refresh", headers={"Authorization": f"Bearer {old}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    new = _claims(body["access_token"])
    assert new["sub"] == str(test_user.id)
    lifetime = get_auth_settings().jwt_expiry_hours * 3600
    assert new["exp"] >= int(time.time()) + lifetime - 5
    assert new["exp"] > _claims(old)["exp"]
    # The new token works.
    me = await token_client.get(
        "/users/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200


async def test_refresh_needs_a_token(anon_client: AsyncClient) -> None:
    assert (await anon_client.post("/auth/refresh")).status_code == 401


async def test_an_expired_token_cannot_be_refreshed(
    token_client: AsyncClient, test_user: UserRecord
) -> None:
    expired = _token(test_user, -10)
    resp = await token_client.post("/auth/refresh", headers={"Authorization": f"Bearer {expired}"})
    assert resp.status_code == 401


async def test_an_inactive_user_cannot_refresh(
    token_client: AsyncClient, test_user: UserRecord, db: AsyncSession
) -> None:
    test_user.is_active = False
    await db.commit()
    assert (await token_client.post("/auth/refresh")).status_code == 401
