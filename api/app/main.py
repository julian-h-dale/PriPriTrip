"""FastAPI application factory.

Early-development pattern: Base.metadata.create_all in lifespan creates
tables on startup. Once the schema stabilises, remove create_all and
switch to Alembic migrations (see quickstart_technical.md).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine
from app.models import Base
from app.routers import admin, config, sharing, trips
from app.schemas import UserCreate, UserRead, UserUpdate
from app.settings import get_app_settings
from app.users import auth_backend, fastapi_users


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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

    # Auth + register routers first.
    application.include_router(
        fastapi_users.get_auth_router(auth_backend), prefix="/auth", tags=["auth"]
    )
    application.include_router(
        fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth", tags=["auth"]
    )
    application.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"]
    )

    # Then feature routers.
    # Before trips.router: its POST /trips/join must not be read as a trip id.
    application.include_router(sharing.router)
    application.include_router(trips.router)
    application.include_router(trips.schema_router)
    application.include_router(config.router)
    application.include_router(admin.router)

    @application.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
