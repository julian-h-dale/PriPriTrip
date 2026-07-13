import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    auth,
    chat,
    profile,
    trip,
    trip_ai_import,
    trip_days,
    trip_details,
    trip_gaps,
    trip_import,
    trip_points,
)
from app.services.prompt_composer import validate_prompt_sections
from app.settings import get_settings
from app.users import UserCreate, UserRead, _jwt_secret, auth_backend, fastapi_users


def create_app() -> FastAPI:
    validate_prompt_sections()

    settings = get_settings()

    # Fail fast at boot (not on the first login) if the JWT secret is missing.
    _jwt_secret()

    # Ensure our app.* loggers emit at INFO and reach a handler even under
    # uvicorn (which does not configure the root logger).
    app_logger = logging.getLogger("app")
    app_logger.setLevel(settings.app_log_level.upper())
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        app_logger.addHandler(handler)
        app_logger.propagate = False

    application = FastAPI(title="PriPriTrip API")

    # Env-driven allowlist. "*" with credentials would let any website make
    # credentialed requests to the API (Starlette echoes the request Origin).
    cors_origins = [
        origin.strip()
        for origin in settings.cors_origins.split(",")
        if origin.strip()
    ]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
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

    # POST /auth/session, /auth/register/session → { token, mapsApiKey }
    application.include_router(auth.router)

    application.include_router(trip.router)
    application.include_router(trip_days.router)
    application.include_router(trip_points.router)
    application.include_router(trip_details.router)
    application.include_router(trip_gaps.router)
    application.include_router(trip_import.router)
    application.include_router(trip_ai_import.router)
    application.include_router(chat.router)
    application.include_router(profile.router)

    @application.get("/health", tags=["meta"])
    async def health():
        return {"status": "ok"}

    return application


app = create_app()
