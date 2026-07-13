"""Read-only share links (docs/share_links_plan.md).

A share link is a bearer capability: whoever holds the URL can read the trip,
with no account and no identity. That is the point — your partner should not
have to sign up to see where you are staying.

The security model is therefore *not* secrecy of the token at rest (it is stored
in plaintext, because the owner has to be able to copy the link again). It is:

- 256 bits of entropy, so the token cannot be guessed;
- instant revocation, so a link that got away can be killed;
- one live link per trip, so revoking is unambiguous;
- and a single function — `resolve_share_token` — that decides whether a link is
  live, so "is this still valid?" has exactly one answer everywhere.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TripRecord, TripShareRecord

# 32 bytes -> 43 URL-safe characters. Not guessable; short enough to paste.
_TOKEN_BYTES = 32


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_token() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


def share_url(token: str, *, base_url: str) -> str:
    return f"{base_url.rstrip('/')}/shared/{token}"


async def active_share(db: AsyncSession, *, trip_id: str) -> TripShareRecord | None:
    """The trip's live link, if it has one.

    Expiry is checked here as well as at resolve time so the owner's own view of
    the link agrees with what a visitor would get.
    """
    result = await db.execute(
        select(TripShareRecord).where(
            TripShareRecord.trip_id == trip_id,
            TripShareRecord.revoked_at.is_(None),
        )
    )
    share = result.scalar_one_or_none()
    if share is None:
        return None
    if share.expires_at is not None and share.expires_at <= _now():
        return None
    return share


async def create_or_get_share(
    db: AsyncSession,
    *,
    trip: TripRecord,
    expires_in_days: int | None = None,
) -> TripShareRecord:
    """Mint a link, or hand back the live one.

    Idempotent on purpose: tapping "share" twice must not silently invalidate
    the URL already sitting in someone's messages. Getting a *new* token is an
    explicit revoke-then-create.
    """
    existing = await active_share(db, trip_id=trip.trip_id)
    if existing is not None:
        return existing

    # An expired-but-not-revoked row still holds the one-live-share index slot,
    # so retire it before taking that slot for the new link.
    stale = await db.execute(
        select(TripShareRecord).where(
            TripShareRecord.trip_id == trip.trip_id,
            TripShareRecord.revoked_at.is_(None),
        )
    )
    for row in stale.scalars().all():
        row.revoked_at = _now()
    await db.flush()

    share = TripShareRecord(
        share_id=str(uuid.uuid4()),
        trip_id=trip.trip_id,
        token=new_token(),
        expires_at=_now() + timedelta(days=expires_in_days) if expires_in_days else None,
    )
    db.add(share)
    await db.flush()
    return share


async def revoke_share(db: AsyncSession, *, trip_id: str) -> bool:
    """Kill the trip's live link. True if there was one."""
    result = await db.execute(
        select(TripShareRecord).where(
            TripShareRecord.trip_id == trip_id,
            TripShareRecord.revoked_at.is_(None),
        )
    )
    shares = result.scalars().all()
    if not shares:
        return False
    for share in shares:
        share.revoked_at = _now()
    await db.flush()
    return True


async def resolve_share_token(db: AsyncSession, token: str) -> TripRecord | None:
    """The trip this link opens — or None if the link is not live.

    Unknown, revoked, expired, and pointing-at-a-deleted-trip all return None,
    so the caller cannot accidentally distinguish them in its response. A 403
    would confirm the token existed; a 404 says nothing.
    """
    if not token:
        return None

    result = await db.execute(
        select(TripShareRecord).where(TripShareRecord.token == token)
    )
    share = result.scalar_one_or_none()
    if share is None or share.revoked_at is not None:
        return None
    if share.expires_at is not None and share.expires_at <= _now():
        return None

    trip = await db.get(TripRecord, share.trip_id)
    if trip is None or bool(trip.is_deleted) or trip.deleted_at is not None:
        return None

    share.view_count = (share.view_count or 0) + 1
    share.last_viewed_at = _now()
    await db.flush()
    return trip
