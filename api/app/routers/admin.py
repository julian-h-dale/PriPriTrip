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

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRecord
from app.schemas import BackupJournal, BackupPhotoPage, UserRead
from app.services import backup as backup_service
from app.services import users as users_service
from app.users import current_superuser

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(current_superuser)])


@router.get("/users", response_model=list[UserRead])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserRecord]:
    return await users_service.list_users(db)


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
