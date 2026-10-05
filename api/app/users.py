"""fastapi-users configuration: user manager, JWT auth backend, dependencies."""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRecord
from app.settings import get_auth_settings


async def get_user_db(
    session: AsyncSession = Depends(get_db),
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    yield SQLAlchemyUserDatabase(session, UserRecord)


class UserManager(UUIDIDMixin, BaseUserManager[UserRecord, uuid.UUID]):
    @property
    def reset_password_token_secret(self) -> str:  # type: ignore[override]
        return get_auth_settings().jwt_secret

    @property
    def verification_token_secret(self) -> str:  # type: ignore[override]
        return get_auth_settings().jwt_secret


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)


bearer_transport = BearerTransport(tokenUrl="auth/login")


def get_jwt_strategy() -> JWTStrategy:
    settings = get_auth_settings()
    return JWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=settings.jwt_expiry_hours * 3600,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[UserRecord, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)


PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED"


async def require_password_ok(user: UserRecord = Depends(current_active_user)) -> UserRecord:
    """Every feature route's gate: someone still holding an admin-issued
    temporary password can only sign in, read /users/me and change it (403
    PASSWORD_CHANGE_REQUIRED otherwise). Mounted on the routers in main.py, so
    a new router gets it by being mounted there."""
    if user.must_change_password:
        raise HTTPException(status.HTTP_403_FORBIDDEN, PASSWORD_CHANGE_REQUIRED)
    return user
