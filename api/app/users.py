"""
fastapi-users configuration.

- Transport: Bearer token (Authorization header)
- Strategy: JWT (stateless, no DB token storage — see get_jwt_strategy)
- User DB: SQLAlchemy async adapter
- Password hashing: bcrypt via fastapi-users built-in
- Email verification: there is no flow, so every account is marked verified
  after it is created (on_after_register). See docs/auth_test_analysis.md §3.1.
"""

import uuid

from fastapi import Depends
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, schemas
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRecord
from app.settings import get_settings

# ── User schemas ──────────────────────────────────────────────────────────────

class UserRead(schemas.BaseUser[uuid.UUID]):
    name: str


class UserCreate(schemas.BaseUserCreate):
    name: str


class UserUpdate(schemas.BaseUserUpdate):
    name: str | None = None


# ── DB adapter ────────────────────────────────────────────────────────────────

async def get_user_db(session: AsyncSession = Depends(get_db)):
    yield SQLAlchemyUserDatabase(session, UserRecord)


# ── UserManager ───────────────────────────────────────────────────────────────

def _jwt_secret() -> str:
    # Settings has no default for jwt_secret, so this raises loudly when
    # JWT_SECRET is missing — a silently-defaulted signing secret means anyone
    # can forge tokens for any user. Set JWT_SECRET in api/.env.
    secret = get_settings().jwt_secret
    if not secret:
        raise RuntimeError("JWT_SECRET must be set (see api/.env.example)")
    return secret


class UserManager(UUIDIDMixin, BaseUserManager[UserRecord, uuid.UUID]):
    reset_password_token_secret = property(lambda self: _jwt_secret())
    verification_token_secret = property(lambda self: _jwt_secret())

    async def on_after_register(self, user: UserRecord, request=None):
        # There is no email-verification flow, so every account is verified by
        # definition. Say so in the data: the day anything asks for
        # `current_user(verified=True)`, an unverified backlog locks out every
        # user at once and the cause looks like sorcery.
        #
        # It has to happen HERE, not by patching the incoming UserCreate. Both
        # registration routes call create(safe=True), and `safe=True` makes
        # fastapi-users strip is_verified (along with is_active/is_superuser)
        # precisely so a stranger POSTing to /auth/register cannot promote
        # themselves. The old create() override set is_verified on the payload
        # and it was silently discarded — every user landed unverified while the
        # module docstring claimed otherwise. See docs/auth_test_analysis.md §3.1.
        if not user.is_verified:
            await self.user_db.update(user, {"is_verified": True})

    async def validate_password(self, password: str, user) -> None:
        # Minimum 8 characters; fastapi-users enforces non-empty by default
        if len(password) < 8:
            from fastapi_users import InvalidPasswordException
            raise InvalidPasswordException(reason="Password must be at least 8 characters.")


async def get_user_manager(user_db=Depends(get_user_db)):
    yield UserManager(user_db)


# ── Auth backend ──────────────────────────────────────────────────────────────

bearer_transport = BearerTransport(tokenUrl="/auth/login")


def get_jwt_strategy() -> JWTStrategy:
    """Stateless tokens — which means a token cannot be revoked.

    POST /auth/logout is a no-op with this strategy: `destroy_token` raises
    NotSupportedError, the backend swallows it, and the token stays valid.
    Logging out is the browser deleting it from localStorage, and that is
    genuinely all that happens — anyone who copied it keeps access.

    So **the lifetime IS the blast radius of a leaked token.** It was 30 days.
    Seven is still generous for a trip-planning app and cuts the exposure by 4x.

    Making logout real means giving the token something server-side to check:
    either fastapi-users' DatabaseStrategy, or keep JWTs and add a `revoked_tokens`
    denylist keyed on the `jti` claim. That is real work and there are no real
    users yet — see docs/auth_test_analysis.md §3.2.
    """
    return JWTStrategy(secret=_jwt_secret(), lifetime_seconds=60 * 60 * 24 * 7)  # 7 days


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

# ── FastAPIUsers instance ─────────────────────────────────────────────────────

fastapi_users = FastAPIUsers[UserRecord, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
