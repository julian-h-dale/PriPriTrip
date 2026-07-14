"""Custom session endpoints (review.md 1C-1).

The frontend wants `{ token, mapsApiKey }` from a single call, which the stock
fastapi-users routers don't provide — hence these two. They go through
`Depends(get_user_manager)` like everything else, so `app.dependency_overrides`
works and the credential flows are testable without a database.

The stock routers (POST /auth/login, /auth/logout, /auth/register) are still
mounted in main.py.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions as fu_exc

from app.schemas import AuthResponse, LoginRequest
from app.settings import get_settings
from app.users import UserCreate, UserManager, get_jwt_strategy, get_user_manager

router = APIRouter(prefix="/auth", tags=["auth"])


async def _session_response(user) -> AuthResponse:
    token = await get_jwt_strategy().write_token(user)
    return AuthResponse(token=token, mapsApiKey=get_settings().maps_api_key)


@router.post("/session", response_model=AuthResponse)
async def login_session(
    body: LoginRequest,
    manager: UserManager = Depends(get_user_manager),
):
    """Authenticate with { email, password } and return { token, mapsApiKey }."""
    # authenticate() already returns None for both an unknown email and a bad
    # password, so there is nothing to catch here. Letting real failures (a
    # dead database) surface as a 500 is the point — they used to be reported
    # as "Invalid email or password."
    user = await manager.authenticate(
        OAuth2PasswordRequestForm(username=body.email, password=body.password, scope="")
    )

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    return await _session_response(user)


@router.post("/register/session", response_model=AuthResponse)
async def register_and_login(
    body: UserCreate,
    request: Request,
    manager: UserManager = Depends(get_user_manager),
):
    """Register a user and immediately return a session token + mapsApiKey."""
    try:
        user = await manager.create(body, safe=True, request=request)
    except fu_exc.UserAlreadyExists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists.",
        ) from None
    except fu_exc.InvalidPasswordException as exc:
        # Previously a 500: validate_password's rejection propagated unhandled.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.reason,
        ) from exc

    return await _session_response(user)
