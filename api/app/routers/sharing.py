"""Sharing a trip: the owner adds people by email (as a viewer or an
editor), changes their role or removes them; members can leave. The owner
can also turn on a secret view-only link (Run stage 31), rotate it or turn
it off; `links_router` signs a link's visitor in.

Thin handlers; the rules live in services/sharing.py and the access checks in
app/dependencies.py (get_owned_trip / get_viewable_trip).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi_users.authentication import Strategy
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import ViewableTrip, get_owned_trip, get_viewable_trip
from app.models import Trip, TripMember, UserRecord
from app.schemas import LinkRead, MemberInvite, MemberRead, MemberRoleChange
from app.services import share_links, sharing
from app.users import auth_backend, current_active_user

router = APIRouter(prefix="/trips", tags=["sharing"])
# No sign-in: the secret is the credential.
links_router = APIRouter(prefix="/links", tags=["sharing"])


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


# ---- the secret link (owner only) ----


@router.get("/{trip_id}/link", response_model=LinkRead)
async def get_link(trip: Trip = Depends(get_owned_trip)) -> LinkRead:
    return LinkRead(enabled=trip.view_code is not None, secret=trip.view_code)


@router.post("/{trip_id}/link", response_model=LinkRead)
async def enable_link(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> LinkRead:
    """Turn the link on (already on: the same link)."""
    return LinkRead(enabled=True, secret=await share_links.enable(db, trip))


@router.post("/{trip_id}/link/rotate", response_model=LinkRead)
async def rotate_link(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> LinkRead:
    """A new link. The old one stops working, and anyone signed in through
    it is signed out on their next request."""
    return LinkRead(enabled=True, secret=await share_links.rotate(db, trip))


@router.delete("/{trip_id}/link", status_code=status.HTTP_204_NO_CONTENT)
async def disable_link(
    trip: Trip = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await share_links.disable(db, trip)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@links_router.post("/{secret}/session")
async def link_session(
    secret: str,
    db: AsyncSession = Depends(get_db),
    strategy: Strategy = Depends(auth_backend.get_strategy),
) -> Response:
    """Sign in as the trip's link guest, with the same answer as
    /auth/login. 404 for any secret that isn't a live trip's current one."""
    guest = await share_links.guest_for(db, secret)
    if guest is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return await auth_backend.login(strategy, guest)
