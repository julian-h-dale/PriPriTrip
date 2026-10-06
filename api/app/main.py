"""FastAPI application factory.

The schema is managed by Alembic (api/migrations). The app never creates or
alters tables itself: `python -m app.migrate` runs first — from
deploy/start.sh, api/dev.sh and the seed script.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    account,
    admin,
    auth_refresh,
    config,
    memories,
    packing,
    photos,
    sharing,
    trips,
    weather,
)
from app.schemas import UserRead, UserUpdate
from app.settings import get_app_settings
from app.users import auth_backend, fastapi_users, require_password_ok


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


def create_app() -> FastAPI:
    settings = get_app_settings()
    application = FastAPI(title=settings.app_name, lifespan=lifespan)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Auth routers first. No register router: accounts are made by admins
    # (POST /admin/users), never by sign-up.
    application.include_router(
        fastapi_users.get_auth_router(auth_backend), prefix="/auth", tags=["auth"]
    )
    application.include_router(auth_refresh.router)
    application.include_router(account.router)
    application.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"]
    )

    # Then feature routers.
    # Before trips.router: its POST /trips/join must not be read as a trip id.
    # Every feature router is behind require_password_ok: someone with an
    # admin-issued temporary password must change it first. (Photos guard
    # their upload/delete routes themselves: serving is login-free.)
    password_ok = [Depends(require_password_ok)]
    application.include_router(sharing.router, dependencies=password_ok)
    application.include_router(trips.router, dependencies=password_ok)
    application.include_router(memories.router, dependencies=password_ok)
    application.include_router(photos.router)
    application.include_router(weather.router, dependencies=password_ok)
    application.include_router(packing.router, dependencies=password_ok)
    application.include_router(trips.schema_router)
    application.include_router(config.router, dependencies=password_ok)
    application.include_router(admin.router, dependencies=password_ok)

    @application.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
