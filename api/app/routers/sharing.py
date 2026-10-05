"""Sharing a trip: join it (as a viewer or an editor), see and remove its
members, get or renew its edit code, leave it.

Thin handlers; the rules live in services/sharing.py and the access checks in
app/dependencies.py (get_owned_trip / get_viewable_trip).
"""

from __future__ import annotations

import contextlib
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import MemberRole, ViewableTrip, active, get_owned_trip, get_viewable_trip
from app.models import Trip, UserRecord
from app.schemas import EditCode, JoinTrip, MemberRead, TripSummary
from app.services import sharing
from app.services import trips as trips_service
from app.users import current_active_user

router = APIRouter(prefix="/trips", tags=["sharing"])


@router.post("/join", response_model=TripSummary)
async def join_trip(
    body: JoinTrip,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> TripSummary:
    """Join a trip: its id makes you a viewer, its edit code an editor.
    Joining again with the other code switches to that code's role."""
    code = (body.code or "").strip()
    trip_id = body.trip_id
    if trip_id is None and code:
        with contextlib.suppress(ValueError):
            trip_id = uuid.UUID(code)
    if trip_id is not None:
        trip = await db.scalar(select(Trip).where(Trip.id == trip_id, active(Trip)))
        role: MemberRole = "viewer"
    elif code:
        trip = await sharing.trip_for_edit_code(db, code)
        role = "editor"
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give a trip id or an edit code")
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No trip with that code")
    if trip.user_id == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This is already your trip")
    await sharing.join(db, trip, user.id, role)
    return await trips_service.trip_summary(db, trip, role)


@router.get("/{trip_id}/members", response_model=list[MemberRead])
async def list_members(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> list[MemberRead]:
    """The trip's members and their roles (owner only)."""
    return [
        MemberRead(
            user_id=user.id,
            email=user.email,
            role="editor" if member.role == "editor" else "viewer",
            joined_at=member.created_at,
        )
        for member, user in await sharing.list_members(db, trip.id)
    ]


@router.get("/{trip_id}/edit-code", response_model=EditCode)
async def get_edit_code(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> EditCode:
    """The code that makes whoever joins with it an editor (owner only).
    Made on first ask."""
    return EditCode(code=await sharing.edit_code(db, trip))


@router.post("/{trip_id}/edit-code", response_model=EditCode)
async def renew_edit_code(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> EditCode:
    """A new edit code (owner only). The old one stops working; anyone who
    already joined keeps their role."""
    return EditCode(code=await sharing.edit_code(db, trip, renew=True))


@router.delete("/{trip_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: uuid.UUID,
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove a member from the trip (owner only)."""
    member = await sharing.membership(db, trip.id, user_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await sharing.leave(db, member)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{trip_id}/membership", status_code=status.HTTP_204_NO_CONTENT)
async def leave_trip(
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Response:
    """Leave a trip you joined. The owner can't leave their own trip."""
    if viewable.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "You own this trip; delete it instead")
    member = await sharing.membership(db, viewable.trip.id, user.id)
    if member is not None:
        await sharing.leave(db, member)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
