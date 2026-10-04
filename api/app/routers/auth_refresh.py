"""A sliding sign-in: swap a still-valid token for a fresh one.

Beside fastapi-users' own `/auth/login`, with the same response shape
(`{access_token, token_type}`). The app calls it at most once a day while in
use, so any use within the token's lifetime keeps the user signed in; an
expired token, or an inactive user, gets 401 like any other route.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from fastapi_users.authentication import Strategy

from app.models import UserRecord
from app.users import auth_backend, current_active_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/refresh")
async def refresh_token(
    user: UserRecord = Depends(current_active_user),
    strategy: Strategy = Depends(auth_backend.get_strategy),
) -> Response:
    return await auth_backend.login(strategy, user)
