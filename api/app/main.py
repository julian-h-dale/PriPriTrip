import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import get_db
from app.routers import trip, trip_ai_import, trip_days, trip_import, trip_points
from app.schemas import AuthResponse
from app.users import UserCreate, UserRead, UserUpdate, auth_backend, fastapi_users, get_user_manager


def create_app() -> FastAPI:
    # Ensure our app.* loggers emit at INFO and reach a handler even under
    # uvicorn (which does not configure the root logger).
    app_logger = logging.getLogger("app")
    app_logger.setLevel(os.environ.get("APP_LOG_LEVEL", "INFO").upper())
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        app_logger.addHandler(handler)
        app_logger.propagate = False

    application = FastAPI(title="PriPriTrip API")

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── fastapi-users standard auth routes ────────────────────────────────────
    # POST /auth/login  → returns { access_token, token_type }
    # POST /auth/logout
    application.include_router(
        fastapi_users.get_auth_router(auth_backend),
        prefix="/auth",
        tags=["auth"],
    )

    # POST /auth/register  → creates user, returns UserRead
    application.include_router(
        fastapi_users.get_register_router(UserRead, UserCreate),
        prefix="/auth",
        tags=["auth"],
    )

    # ── Custom /auth/session — login returning { token, mapsApiKey } ──────────
    from pydantic import BaseModel as _BaseModel

    class _LoginBody(_BaseModel):
        email: str
        password: str

    @application.post("/auth/session", response_model=AuthResponse, tags=["auth"])
    async def login_session(body: _LoginBody, request: Request):
        """
        Accepts { email, password }, authenticates via fastapi-users,
        and returns { token, mapsApiKey } for frontend compatibility.
        """
        from fastapi import HTTPException, status as http_status
        from fastapi_users import exceptions as fu_exc
        from app.database import AsyncSessionLocal
        from app.models import UserRecord as _UserRecord
        from app.users import get_jwt_strategy, UserManager

        async with AsyncSessionLocal() as session:
            from fastapi_users.db import SQLAlchemyUserDatabase
            user_db = SQLAlchemyUserDatabase(session, _UserRecord)
            manager = UserManager(user_db)
            try:
                user = await manager.authenticate(
                    credentials=type("_Creds", (), {"username": body.email, "password": body.password})()
                )
            except Exception:
                user = None

            if user is None or not user.is_active:
                raise HTTPException(
                    status_code=http_status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password.",
                )

        strategy = get_jwt_strategy()
        token = await strategy.write_token(user)
        maps_api_key = os.environ.get("MAPS_API_KEY", "")
        return AuthResponse(token=token, mapsApiKey=maps_api_key)

    # ── Custom register endpoint returning AuthResponse ────────────────────────
    @application.post("/auth/register/session", response_model=AuthResponse, tags=["auth"])
    async def register_and_login(body: UserCreate, request: Request):
        """
        Register a new user and immediately return a session token + mapsApiKey.
        Delegates creation to fastapi-users UserManager, then issues a JWT.
        """
        from fastapi import HTTPException, status as http_status
        from fastapi_users import exceptions as fu_exc
        from app.database import AsyncSessionLocal
        from app.models import UserRecord
        from app.users import get_jwt_strategy

        async with AsyncSessionLocal() as session:
            from fastapi_users.db import SQLAlchemyUserDatabase
            user_db = SQLAlchemyUserDatabase(session, UserRecord)
            from app.users import UserManager
            manager = UserManager(user_db)
            try:
                user = await manager.create(body, safe=True, request=request)
            except fu_exc.UserAlreadyExists:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="A user with this email already exists.",
                )

        strategy = get_jwt_strategy()
        token = await strategy.write_token(user)
        maps_api_key = os.environ.get("MAPS_API_KEY", "")
        return AuthResponse(token=token, mapsApiKey=maps_api_key)

    application.include_router(trip.router)
    application.include_router(trip_days.router)
    application.include_router(trip_points.router)
    application.include_router(trip_import.router)
    application.include_router(trip_ai_import.router)

    @application.get("/health", tags=["meta"])
    async def health():
        return {"status": "ok"}

    return application


app = create_app()
