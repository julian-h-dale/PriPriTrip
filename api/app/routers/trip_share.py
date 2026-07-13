"""Share-link endpoints (docs/share_links_plan.md).

Two routers, because they are two very different things:

- `router` is owner-only and lives under /trips/{trip_id}/share.
- `public_router` is **the only unauthenticated endpoint in the app that returns
  user data**. It never reads the Authorization header, so it behaves the same
  signed-in and signed-out, and it returns SharedTripResponse — a schema of its
  own, so a field added to the owner's trip view later cannot silently start
  leaking through a public link.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import TripRecord, TripShareRecord
from app.schemas import SharedTripResponse, TripShareResponse
from app.services.trip_share import (
    active_share,
    create_or_get_share,
    resolve_share_token,
    revoke_share,
    share_url,
)
from app.services.trip_state import assembled_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["share"])
public_router = APIRouter(tags=["share"])

_LINK_GONE = "This link is no longer active."


def _origin(request: Request) -> str:
    """Where to point the link.

    The API and the UI are different origins in development, and the link has to
    open the *UI*. Referer is the browser tab that asked, which is the UI; fall
    back to the request's own base URL when there isn't one (curl, tests).
    """
    referer = request.headers.get("referer")
    if referer:
        from urllib.parse import urlparse

        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    return str(request.base_url).rstrip("/")


def _to_response(share: TripShareRecord, *, request: Request) -> TripShareResponse:
    return TripShareResponse(
        shareId=share.share_id,
        tripId=share.trip_id,
        token=share.token,
        url=share_url(share.token, base_url=_origin(request)),
        viewCount=share.view_count or 0,
        lastViewedAt=share.last_viewed_at.isoformat() if share.last_viewed_at else None,
        expiresAt=share.expires_at.isoformat() if share.expires_at else None,
        createdAt=share.created_at.isoformat() if share.created_at else None,
    )


@router.post("/share", response_model=TripShareResponse, status_code=status.HTTP_200_OK)
async def create_trip_share(
    request: Request,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    """Mint a read-only link, or hand back the live one.

    Idempotent: tapping "share" twice must not invalidate the URL already
    sitting in someone's messages.
    """
    share = await create_or_get_share(db, trip=trip)
    await db.commit()
    await db.refresh(share)
    return _to_response(share, request=request)


@router.get("/share", response_model=TripShareResponse)
async def get_trip_share(
    request: Request,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    share = await active_share(db, trip_id=trip.trip_id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This trip is not shared.")
    return _to_response(share, request=request)


@router.delete("/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_trip_share(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    """Kill the link. The URL 404s from the next request onwards."""
    await revoke_share(db, trip_id=trip.trip_id)
    await db.commit()


@public_router.get("/shared/{token}", response_model=SharedTripResponse)
async def read_shared_trip(token: str, db: AsyncSession = Depends(get_db)):
    """The trip behind a share link. No authentication, by design.

    Unknown, revoked, expired and deleted-trip all return the same 404 with the
    same message: a 403 would confirm the token had once existed.
    """
    trip = await resolve_share_token(db, token)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_LINK_GONE)

    payload = SharedTripResponse.from_trip(await assembled_trip(db, trip))
    await db.commit()  # persist the view count bump
    return payload
