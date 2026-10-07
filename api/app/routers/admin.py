"""Admin router — every route here is behind current_superuser.

The guard is declared once on the router rather than repeated per route, so a
new endpoint added here is protected by default (forgetting the guard is the
expensive mistake). The whole admin surface is greppable as `/admin/*`.

`Depends(current_superuser)` returns 403 for an authenticated non-admin and
401 for anonymous — the correct pair, for free. The 404-not-403 rule elsewhere
is about not leaking whether a *row* exists, which doesn't apply to a
capability check on a collection everyone knows exists.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRecord
from app.schemas import (
    BackupJournal,
    BackupPhotoPage,
    InvitedUser,
    InviteUser,
    SetAdmin,
    TemporaryPassword,
    UserRead,
)
from app.services import backup as backup_service
from app.services import users as users_service
from app.users import current_superuser

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(current_superuser)])


@router.get("/users", response_model=list[UserRead])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserRecord]:
    return await users_service.list_users(db)


@router.post("/users", response_model=InvitedUser, status_code=status.HTTP_201_CREATED)
async def invite_user(body: InviteUser, db: AsyncSession = Depends(get_db)) -> InvitedUser:
    """A new account with a random temporary password, returned once for the
    admin to send. They choose their own when they first sign in."""
    try:
        user, password = await users_service.invite(db, body.email, body.name)
    except users_service.EmailTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone already has that email") from None
    return InvitedUser(user=UserRead.model_validate(user), temporary_password=password)


@router.patch("/users/{user_id}", response_model=UserRead)
async def set_admin(
    user_id: uuid.UUID,
    body: SetAdmin,
    db: AsyncSession = Depends(get_db),
    admin: UserRecord = Depends(current_superuser),
) -> UserRecord:
    """Make someone an admin of the app, or a plain user. Never your own row
    (another admin can change it), and never the last admin."""
    if user_id == admin.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't change your own role")
    user = await db.get(UserRecord, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    try:
        return await users_service.set_admin(db, user, body.is_superuser)
    except users_service.LastAdmin:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "There has to be at least one admin"
        ) from None


@router.post("/users/{user_id}/reset-password", response_model=TemporaryPassword)
async def reset_password(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: UserRecord = Depends(current_superuser),
) -> TemporaryPassword:
    """A new temporary password, returned once. Until they change it, their
    account — including any phone still signed in — can do nothing else."""
    if user_id == admin.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Use Change password for your own")
    user = await db.get(UserRecord, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return TemporaryPassword(temporary_password=await users_service.reset_password(db, user))


# ---- backups: what the Pi pulls (scripts/pi-backup/) ----


@router.get("/backup/photos", response_model=BackupPhotoPage)
async def backup_photos(
    after: str | None = Query(default=None, max_length=200),
    db: AsyncSession = Depends(get_db),
) -> BackupPhotoPage:
    """Every live photo, oldest upload first, 500 a page. Pass the page's
    `next` as `after` for the next one. Fetch each original from its
    `originalUrl`."""
    try:
        return await backup_service.photo_page(db, after)
    except backup_service.BadCursor as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Bad cursor: {exc}") from None


@router.get("/backup/journals", response_model=list[BackupJournal])
async def backup_journals(db: AsyncSession = Depends(get_db)) -> list[BackupJournal]:
    """Every trip's journal: all live memories, public or not."""
    return await backup_service.journals(db)
