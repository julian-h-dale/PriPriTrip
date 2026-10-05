"""Your own account: change your password. Beside fastapi-users' /auth
routes, and like them reachable while you still have a temporary password —
this is how you get rid of it. Returns a fresh token (the same shape as
/auth/login)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi_users.authentication import Strategy
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRecord
from app.schemas import ChangePassword
from app.services import users as users_service
from app.users import auth_backend, current_active_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/change-password")
async def change_password(
    body: ChangePassword,
    user: UserRecord = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
    strategy: Strategy = Depends(auth_backend.get_strategy),
) -> Response:
    try:
        ok = await users_service.change_password(db, user, body.current_password, body.new_password)
    except users_service.WeakPassword as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password isn't right")
    return await auth_backend.login(strategy, user)
