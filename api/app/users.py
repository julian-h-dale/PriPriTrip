"""
fastapi-users configuration.

- Transport: Bearer token (Authorization header)
- Strategy: JWT (stateless, no DB token storage)
- User DB: SQLAlchemy async adapter
- Password hashing: bcrypt via fastapi-users built-in
- Email verification: disabled (is_verified defaults to True on create)
"""

import os
import uuid
from typing import Optional

from fastapi import Depends
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, schemas
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.db import SQLAlchemyUserDatabase
from pydantic import EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRecord


# ── User schemas ──────────────────────────────────────────────────────────────

class UserRead(schemas.BaseUser[uuid.UUID]):
    name: str


class UserCreate(schemas.BaseUserCreate):
    name: str


class UserUpdate(schemas.BaseUserUpdate):
    name: Optional[str] = None


# ── DB adapter ────────────────────────────────────────────────────────────────

async def get_user_db(session: AsyncSession = Depends(get_db)):
    yield SQLAlchemyUserDatabase(session, UserRecord)


# ── UserManager ───────────────────────────────────────────────────────────────

def _jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "dev-secret-change-me")


class UserManager(UUIDIDMixin, BaseUserManager[UserRecord, uuid.UUID]):
    reset_password_token_secret = property(lambda self: _jwt_secret())
    verification_token_secret = property(lambda self: _jwt_secret())

    async def on_after_register(self, user: UserRecord, request=None):
        pass  # no-op; extend here for welcome emails etc.

    async def validate_password(self, password: str, user) -> None:
        # Minimum 8 characters; fastapi-users enforces non-empty by default
        if len(password) < 8:
            from fastapi_users import InvalidPasswordException
            raise InvalidPasswordException(reason="Password must be at least 8 characters.")

    async def create(self, user_create: UserCreate, safe: bool = False, request=None):
        # Auto-verify on creation — no email verification flow
        user_dict = user_create.model_dump()
        user_dict["is_verified"] = True
        from fastapi_users import schemas as fu_schemas
        patched = user_create.model_copy(update={"is_verified": True})
        return await super().create(patched, safe=safe, request=request)


async def get_user_manager(user_db=Depends(get_user_db)):
    yield UserManager(user_db)


# ── Auth backend ──────────────────────────────────────────────────────────────

bearer_transport = BearerTransport(tokenUrl="/auth/login")


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=_jwt_secret(), lifetime_seconds=60 * 60 * 24 * 30)  # 30 days


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

# ── FastAPIUsers instance ─────────────────────────────────────────────────────

fastapi_users = FastAPIUsers[UserRecord, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
