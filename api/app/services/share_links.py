"""A trip's secret link (Run stage 31): anyone with it can view the trip
without an account (family following along).

Turning the link on makes a hidden **guest** account for the trip
(`users.guest_trip_id`), a viewer member of it. Opening the link signs the
browser in as that guest, so everything a viewer may or may not do is the
server's existing role checks, unchanged. The secret is stored in
`trips.view_code` (unused since Run 26 removed join codes).

Rotating or turning the link off turns that guest account off: every
request checks `is_active`, so anyone using the old link is signed out on
their next request, and its secret stops working.
"""

from __future__ import annotations

import datetime as dt
import secrets
import uuid
from typing import Any

from fastapi_users.password import PasswordHelper
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import active
from app.models import Trip, TripMember, UserRecord

GUEST_NAME = "Anyone with the link"
# fastapi-users types the column as a plain bool; it's a column here.
_IS_ACTIVE: Any = UserRecord.is_active
_passwords = PasswordHelper()


def _new_secret() -> str:
    """256 random bits, URL-safe (43 characters)."""
    return secrets.token_urlsafe(32)


async def _guests(db: AsyncSession, trip_id: uuid.UUID) -> list[UserRecord]:
    result = await db.execute(
        select(UserRecord).where(UserRecord.guest_trip_id == trip_id, _IS_ACTIVE.is_(True))
    )
    return list(result.scalars().all())


async def _retire(db: AsyncSession, trip: Trip) -> None:
    """Turn off the trip's guest account(s) and end their membership."""
    now = dt.datetime.now(dt.UTC)
    for guest in await _guests(db, trip.id):
        guest.is_active = False
        memberships = await db.execute(
            select(TripMember).where(TripMember.user_id == guest.id, active(TripMember))
        )
        for member in memberships.scalars():
            member.is_deleted = True
            member.deleted_at = now


async def _start(db: AsyncSession, trip: Trip) -> None:
    """A fresh secret and a fresh guest account, a viewer of the trip."""
    guest = UserRecord(
        id=uuid.uuid4(),
        # example.com is reserved (RFC 2606): never a real mailbox. (".invalid"
        # would be better, but the account library refuses it.)
        email=f"link-{uuid.uuid4().hex}@guest.example.com",
        name=GUEST_NAME,
        # Nobody knows it: a guest only ever signs in through the link.
        hashed_password=_passwords.hash(secrets.token_urlsafe(32)),
        is_active=True,
        is_verified=True,
        is_superuser=False,
        analytics_enabled=True,
        guest_trip_id=trip.id,
    )
    db.add(guest)
    await db.flush()  # the account exists before its membership points at it
    db.add(TripMember(trip_id=trip.id, user_id=guest.id, role="viewer"))
    trip.view_code = _new_secret()


async def enable(db: AsyncSession, trip: Trip) -> str:
    """Turn the link on (already on: the same link)."""
    if trip.view_code is None:
        await _start(db, trip)
        await db.commit()
    assert trip.view_code is not None
    return trip.view_code


async def rotate(db: AsyncSession, trip: Trip) -> str:
    """A new link; the old one, and everyone signed in through it, stop."""
    await _retire(db, trip)
    await _start(db, trip)
    await db.commit()
    assert trip.view_code is not None
    return trip.view_code


async def disable(db: AsyncSession, trip: Trip) -> None:
    """Turn the link off. Turning it on again makes a new one."""
    await _retire(db, trip)
    trip.view_code = None
    await db.commit()


async def guest_for(db: AsyncSession, secret: str) -> UserRecord | None:
    """The guest a live trip's current secret signs you in as, or None."""
    trip = await db.scalar(select(Trip).where(Trip.view_code == secret, active(Trip)))
    if trip is None:
        return None
    guests = await _guests(db, trip.id)
    return guests[0] if guests else None


async def forget(db: AsyncSession, trip: Trip) -> None:
    """The trip is being deleted: its link goes with it (no commit)."""
    await _retire(db, trip)
    trip.view_code = None
