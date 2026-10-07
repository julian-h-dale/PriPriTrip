"""Business logic for user administration, kept out of route handlers.

Admins invite people and reset passwords; either way the person gets a
random temporary password (shown to the admin once, to send) and must choose
their own at sign-in (`must_change_password`). Admins also make someone an
admin of the app, or take it away (`is_superuser`), never the last one.
"""

from __future__ import annotations

import secrets
import uuid

from fastapi_users.password import PasswordHelper
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserRecord

# Lowercase letters and digits without look-alikes (0/o, 1/l/i): easy to read
# out or type from a text message.
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
MIN_PASSWORD_LENGTH = 8

_passwords = PasswordHelper()


class EmailTaken(Exception):
    pass


class WeakPassword(ValueError):
    pass


class LastAdmin(Exception):
    """Taking admin from the only admin left would leave nobody to give it back."""


def temporary_password() -> str:
    """e.g. "k7mq-x2pd-9rhw": about 59 bits, never guessable from the email."""
    return "-".join("".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(3))


async def list_users(db: AsyncSession) -> list[UserRecord]:
    result = await db.execute(select(UserRecord).order_by(UserRecord.email))
    return list(result.scalars().all())


async def invite(db: AsyncSession, email: str, name: str) -> tuple[UserRecord, str]:
    """A new, active account with a temporary password it must change."""
    email = email.strip().lower()
    taken = await db.scalar(select(UserRecord).filter_by(email=email))
    if taken is not None:
        raise EmailTaken()
    password = temporary_password()
    user = UserRecord(
        id=uuid.uuid4(),
        email=email,
        name=name.strip(),
        hashed_password=_passwords.hash(password),
        is_active=True,
        is_verified=True,
        is_superuser=False,
        must_change_password=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user, password


async def set_admin(db: AsyncSession, user: UserRecord, admin: bool) -> UserRecord:
    """Make `user` an admin of the app, or a plain user; never the last admin
    (counting active admins: an inactive one can't sign in to give it back)."""
    if user.is_superuser and not admin:
        admins = await db.scalar(
            select(func.count())
            .select_from(UserRecord)
            # Through the table: fastapi-users types these attributes as plain bools.
            .where(
                UserRecord.__table__.c.is_superuser.is_(True),
                UserRecord.__table__.c.is_active.is_(True),
            )
        )
        if (admins or 0) <= 1:
            raise LastAdmin()
    user.is_superuser = admin
    await db.commit()
    await db.refresh(user)
    return user


async def reset_password(db: AsyncSession, user: UserRecord) -> str:
    """A new temporary password; until they change it, their account (and any
    phone still signed in) can do nothing else."""
    password = temporary_password()
    user.hashed_password = _passwords.hash(password)
    user.must_change_password = True
    await db.commit()
    return password


def check_new_password(new: str, current: str) -> None:
    if len(new) < MIN_PASSWORD_LENGTH:
        raise WeakPassword(f"Use at least {MIN_PASSWORD_LENGTH} characters")
    if new == current:
        raise WeakPassword("Choose a password different from the current one")
    if new.lower().startswith("changeme"):
        raise WeakPassword("Choose your own password, not a default one")


async def change_password(db: AsyncSession, user: UserRecord, current: str, new: str) -> bool:
    """False when `current` is wrong. Raises WeakPassword for a poor new one."""
    verified, _ = _passwords.verify_and_update(current, user.hashed_password)
    if not verified:
        return False
    check_new_password(new, current)
    user.hashed_password = _passwords.hash(new)
    user.must_change_password = False
    await db.commit()
    return True
