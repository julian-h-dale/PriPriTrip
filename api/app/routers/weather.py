"""Weather for a trip's places (services/weather.py). Anyone who can see the
trip can see its weather. Without an OpenWeatherMap key it answers
`configured: false` (200), so the page can say so; nothing here can fail
because the key is missing."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import ViewableTrip, get_viewable_trip
from app.schemas import WeatherRead
from app.services import trips as trips_service
from app.services import weather as weather_service

router = APIRouter(prefix="/trips/{trip_id}", tags=["weather"])


@router.get("/weather", response_model=WeatherRead)
async def trip_weather(
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
) -> WeatherRead:
    """Today's weather and each trip day's forecast (8 days out) or long-range
    outlook, at the trip's places. Metric units. Cached for 12 hours."""
    trip = await trips_service.get_trip(db, viewable.trip.id, viewable.role)
    return await weather_service.trip_weather(db, trip)
