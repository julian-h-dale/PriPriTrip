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

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRecord
from app.schemas import UserRead
from app.services import users as users_service
from app.users import current_superuser

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(current_superuser)])


@router.get("/users", response_model=list[UserRead])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserRecord]:
    return await users_service.list_users(db)
