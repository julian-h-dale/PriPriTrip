"""Client configuration and the timezone lookup the forms preview with."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.models import UserRecord
from app.schemas import CamelModel
from app.settings import get_app_settings
from app.users import current_active_user
from app.zones import zone_at

router = APIRouter(tags=["config"])


class ClientConfig(CamelModel):
    google_maps_api_key: str | None
    google_maps_map_id: str | None


class TimezoneAt(CamelModel):
    timezone: str | None


@router.get("/config", response_model=ClientConfig)
async def get_config(_: UserRecord = Depends(current_active_user)) -> ClientConfig:
    """What the signed-in client needs at runtime. The Maps key and Map ID are
    public by design, protected by restrictions in the Google console."""
    settings = get_app_settings()
    return ClientConfig(
        google_maps_api_key=settings.google_maps_api_key or None,
        google_maps_map_id=settings.google_maps_map_id or None,
    )


@router.get("/timezone", response_model=TimezoneAt)
async def get_timezone(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    _: UserRecord = Depends(current_active_user),
) -> TimezoneAt:
    """The zone at a coordinate — the same lookup the server applies when it
    reads a trip, so a form's "Times here are Zurich time" can't disagree."""
    return TimezoneAt(timezone=zone_at(lat, lng))
