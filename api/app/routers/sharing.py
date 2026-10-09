"""Sharing a trip: the owner adds people by email (as a viewer or an
editor), changes their role or removes them; members can leave.

Thin handlers; the rules live in services/sharing.py and the access checks in
app/dependencies.py (get_owned_trip / get_viewable_trip).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import ViewableTrip, get_owned_trip, get_viewable_trip
from app.models import Trip, TripMember, UserRecord
from app.schemas import MemberInvite, MemberRead, MemberRoleChange
from app.services import sharing
from app.users import current_active_user

router = APIRouter(prefix="/trips", tags=["sharing"])


def _read(member: TripMember, user: UserRecord) -> MemberRead:
    return MemberRead(
        user_id=user.id,
        email=user.email,
        name=user.name,
        role="editor" if member.role == "editor" else "viewer",
        joined_at=member.created_at,
    )


@router.get("/{trip_id}/members", response_model=list[MemberRead])
async def list_members(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> list[MemberRead]:
    """The trip's members and their roles (owner only)."""
    return [_read(member, user) for member, user in await sharing.list_members(db, trip.id)]


@router.post("/{trip_id}/members", response_model=MemberRead)
async def add_member(
    body: MemberInvite,
    response: Response,
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> MemberRead:
    """Add the account with this email to the trip (owner only): 201 when
    newly added, 200 when they were already on it (their role changes)."""
    try:
        member, user, new = await sharing.add_member(db, trip, body.email, body.role)
    except sharing.NoAccount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account with that email") from None
    except sharing.IsOwner:
        raise HTTPException(status.HTTP_409_CONFLICT, "That's you: you own this trip") from None
    response.status_code = status.HTTP_201_CREATED if new else status.HTTP_200_OK
    return _read(member, user)


@router.patch("/{trip_id}/members/{user_id}", response_model=MemberRead)
async def change_role(
    user_id: uuid.UUID,
    body: MemberRoleChange,
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> MemberRead:
    """Change a member's role (owner only)."""
    member = await sharing.membership(db, trip.id, user_id)
    user = await db.get(UserRecord, user_id) if member is not None else None
    if member is None or user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await sharing.set_role(db, member, body.role)
    return _read(member, user)


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
    """Leave a trip you're on. The owner can't leave their own trip."""
    if viewable.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "You own this trip; delete it instead")
    member = await sharing.membership(db, viewable.trip.id, user.id)
    if member is not None:
        await sharing.leave(db, member)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
