"""Weather for a trip's places, from OpenWeatherMap One Call 3.0, cached.

- **Which place is a day's weather:** where you sleep that night; on a travel
  day with no stay, where the day's last leg lands; otherwise the day
  before's place (and, before the first known place, the first one).
- **What each day gets:** the daily forecast for the next 8 days
  (`/onecall`), OWM's long-range daily summary further out
  (`/onecall/day_summary`), and nothing for days already past.
- **Today:** current conditions at today's place during the trip, at the
  first day's place before it, none after.
- **Cache:** answers are kept in `weather_cache` by rounded place (2 decimal
  places, about 1 km, so nearby days share one lookup). A request reads the
  cache and refreshes anything older than 12 hours, one refresh per key at a
  time. A failed refresh serves the stale copy; with no copy, that day is
  "unavailable". No key configured means no calls at all.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from dataclasses import dataclass
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WeatherCache
from app.schemas import TripRead, WeatherAlert, WeatherDay, WeatherNow, WeatherRead
from app.settings import get_app_settings
from app.trip_document import TripDocument
from app.zones import zone_at

BASE_URL = "https://api.openweathermap.org/data/3.0"
MAX_AGE = dt.timedelta(hours=12)
TIMEOUT = 10.0
# day_summary reaches about 1.5 years ahead.
OUTLOOK_LIMIT = dt.timedelta(days=540)

_locks: dict[str, asyncio.Lock] = {}


class WeatherFetchError(Exception):
    """OpenWeatherMap couldn't be reached or refused the request."""


@dataclass(frozen=True)
class Place:
    name: str
    lat: float
    lng: float

    @property
    def coords(self) -> str:
        return f"{self.lat:.2f},{self.lng:.2f}"

    @property
    def zone(self) -> str:
        return zone_at(self.lat, self.lng) or "UTC"

    def today(self, now: dt.datetime) -> dt.date:
        return now.astimezone(ZoneInfo(self.zone)).date()


def _place(location: Any) -> Place | None:
    if location is None or location.lat is None or location.lng is None:
        return None
    return Place(location.city or location.name, location.lat, location.lng)


def day_places(trip: TripDocument) -> dict[dt.date, Place | None]:
    """Each trip date's place (see the module docstring for the rule)."""
    days: dict[dt.date, Place | None] = {}
    day = trip.start_date
    previous: Place | None = None
    while day <= trip.end_date:
        place = None
        for stay in trip.stays:
            if stay.check_in.date() <= day < stay.check_out.date() and _place(stay.location):
                place = _place(stay.location)
                break
        if place is None:
            landing = [
                t
                for t in trip.travels
                if (t.arrive or t.depart).date() == day and _place(t.to_location)
            ]
            if landing:
                place = _place(max(landing, key=lambda t: t.arrive or t.depart).to_location)
        place = place or previous
        days[day] = place
        previous = place
        day += dt.timedelta(days=1)
    # Days before the first known place take the first one.
    first = next((p for p in days.values() if p is not None), None)
    for day, place in days.items():
        if place is not None:
            break
        days[day] = first
    return days


# ---- OpenWeatherMap ----


async def _get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    """One OWM call. Tests replace this."""
    key = get_app_settings().openweather_api_key
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                f"{BASE_URL}{path}", params={**params, "appid": key, "units": "metric"}
            )
    except httpx.HTTPError as exc:
        raise WeatherFetchError(f"couldn't reach OpenWeatherMap ({type(exc).__name__})") from None
    if resp.status_code == 401:
        raise WeatherFetchError(
            "OpenWeatherMap refused the key (it needs the One Call 3.0 subscription)"
        )
    if resp.status_code == 429:
        raise WeatherFetchError("OpenWeatherMap's daily call limit was reached")
    if resp.status_code != 200:
        raise WeatherFetchError(f"OpenWeatherMap answered {resp.status_code}")
    data: dict[str, Any] = resp.json()
    return data


@dataclass
class Cached:
    payload: dict[str, Any]
    fetched_at: dt.datetime
    stale: bool = False


async def _cached(
    db: AsyncSession,
    key: str,
    path: str,
    params: dict[str, Any],
    now: dt.datetime,
    problems: list[str],
) -> Cached | None:
    """The cache entry for `key`, refreshed first if it's older than 12 hours."""

    async def read() -> WeatherCache | None:
        return await db.scalar(select(WeatherCache).where(WeatherCache.key == key))

    row = await read()
    if row is not None and now - row.fetched_at < MAX_AGE:
        return Cached(row.payload, row.fetched_at)
    async with _locks.setdefault(key, asyncio.Lock()):
        # Someone else may have refreshed it while we waited.
        await db.commit()  # end the read transaction so we see their write
        row = await read()
        if row is not None and now - row.fetched_at < MAX_AGE:
            return Cached(row.payload, row.fetched_at)
        try:
            payload = await _get(path, params)
        except WeatherFetchError as exc:
            if str(exc) not in problems:
                problems.append(str(exc))
            return Cached(row.payload, row.fetched_at, stale=True) if row is not None else None
        if row is None:
            row = WeatherCache(key=key, payload=payload, fetched_at=now)
            db.add(row)
        else:
            row.payload = payload
            row.fetched_at = now
        await db.commit()
        return Cached(payload, now)


# ---- normalising OWM's shapes ----


def _instant(ts: Any) -> dt.datetime | None:
    return dt.datetime.fromtimestamp(ts, dt.UTC) if isinstance(ts, int | float) else None


def _weather(block: dict[str, Any]) -> dict[str, Any]:
    first = (block.get("weather") or [{}])[0]
    return {
        "condition": first.get("main"),
        "description": first.get("description"),
        "icon": first.get("icon"),
    }


def _local_date(entry: dict[str, Any], offset: int) -> dt.date | None:
    at = _instant(entry.get("dt"))
    return (at + dt.timedelta(seconds=offset)).date() if at else None


def _forecast_day(day: dt.date, place: Place, entry: dict[str, Any], cached: Cached) -> WeatherDay:
    temp = entry.get("temp") or {}
    feels = entry.get("feels_like") or {}
    return WeatherDay(
        date=day,
        place=place.name,
        zone=place.zone,
        kind="forecast",
        high=temp.get("max"),
        low=temp.get("min"),
        feels_like=feels.get("day"),
        summary=entry.get("summary"),
        pop=entry.get("pop"),
        rain=entry.get("rain"),
        humidity=entry.get("humidity"),
        clouds=entry.get("clouds"),
        wind_speed=entry.get("wind_speed"),
        wind_gust=entry.get("wind_gust"),
        uvi=entry.get("uvi"),
        sunrise=_instant(entry.get("sunrise")),
        sunset=_instant(entry.get("sunset")),
        fetched_at=cached.fetched_at,
        stale=cached.stale,
        **_weather(entry),
    )


def _outlook_day(day: dt.date, place: Place, data: dict[str, Any], cached: Cached) -> WeatherDay:
    temp = data.get("temperature") or {}
    wind = (data.get("wind") or {}).get("max") or {}
    return WeatherDay(
        date=day,
        place=place.name,
        zone=place.zone,
        kind="outlook",
        high=temp.get("max"),
        low=temp.get("min"),
        rain=(data.get("precipitation") or {}).get("total"),
        humidity=(data.get("humidity") or {}).get("afternoon"),
        clouds=(data.get("cloud_cover") or {}).get("afternoon"),
        wind_speed=wind.get("speed"),
        fetched_at=cached.fetched_at,
        stale=cached.stale,
    )


def _now(place: Place, data: dict[str, Any], cached: Cached) -> WeatherNow | None:
    current = data.get("current")
    if not current or current.get("temp") is None:
        return None
    return WeatherNow(
        place=place.name,
        zone=place.zone,
        observed_at=_instant(current.get("dt")) or cached.fetched_at,
        temp=current["temp"],
        feels_like=current.get("feels_like"),
        humidity=current.get("humidity"),
        wind_speed=current.get("wind_speed"),
        wind_gust=current.get("wind_gust"),
        uvi=current.get("uvi"),
        sunrise=_instant(current.get("sunrise")),
        sunset=_instant(current.get("sunset")),
        fetched_at=cached.fetched_at,
        stale=cached.stale,
        **_weather(current),
    )


def _offset(zone: str, day: dt.date) -> str:
    """`day_summary` wants the place's UTC offset, e.g. "+09:00"."""
    noon = dt.datetime.combine(day, dt.time(12), ZoneInfo(zone))
    offset = noon.utcoffset() or dt.timedelta(0)
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    return f"{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"


# ---- the whole page ----


async def trip_weather(
    db: AsyncSession, trip: TripRead, now: dt.datetime | None = None
) -> WeatherRead:
    if not get_app_settings().openweather_api_key:
        return WeatherRead(configured=False)
    now = now or dt.datetime.now(dt.UTC)
    problems: list[str] = []
    places = day_places(trip)

    async def onecall(place: Place) -> Cached | None:
        return await _cached(
            db,
            f"onecall:{place.coords}",
            "/onecall",
            {"lat": round(place.lat, 2), "lon": round(place.lng, 2), "exclude": "minutely,hourly"},
            now,
            problems,
        )

    onecalls: dict[str, Cached | None] = {}

    async def onecall_for(place: Place) -> Cached | None:
        if place.coords not in onecalls:
            onecalls[place.coords] = await onecall(place)
        return onecalls[place.coords]

    days: list[WeatherDay] = []
    for day, place in places.items():
        if place is None:
            days.append(WeatherDay(date=day, kind="unavailable"))
            continue
        today = place.today(now)
        if day < today:
            days.append(WeatherDay(date=day, place=place.name, kind="past"))
            continue
        if day <= today + dt.timedelta(days=7):
            cached = await onecall_for(place)
            if cached is not None:
                offset = int(cached.payload.get("timezone_offset") or 0)
                entry = next(
                    (e for e in cached.payload.get("daily") or [] if _local_date(e, offset) == day),
                    None,
                )
                if entry is not None:
                    days.append(_forecast_day(day, place, entry, cached))
                    continue
        if day - today <= OUTLOOK_LIMIT:
            cached = await _cached(
                db,
                f"day:{place.coords}:{day.isoformat()}",
                "/onecall/day_summary",
                {
                    "lat": round(place.lat, 2),
                    "lon": round(place.lng, 2),
                    "date": day.isoformat(),
                    "tz": _offset(place.zone, day),
                },
                now,
                problems,
            )
            if cached is not None:
                days.append(_outlook_day(day, place, cached.payload, cached))
                continue
        days.append(WeatherDay(date=day, place=place.name, kind="unavailable"))

    # Today: during the trip, today's place; before it, the first day's.
    today_place: Place | None = None
    first = places.get(trip.start_date)
    if first is not None and first.today(now) < trip.start_date:
        today_place = first
    else:
        for day, place in places.items():
            if place is not None and place.today(now) == day:
                today_place = place
                break
    now_weather: WeatherNow | None = None
    if today_place is not None:
        cached = await onecall_for(today_place)
        if cached is not None:
            now_weather = _now(today_place, cached.payload, cached)

    alerts: list[WeatherAlert] = []
    seen: set[tuple[str, Any]] = set()
    for coords, cached in onecalls.items():
        if cached is None:
            continue
        name = next((p.name for p in places.values() if p and p.coords == coords), coords)
        for alert in cached.payload.get("alerts") or []:
            start, end = _instant(alert.get("start")), _instant(alert.get("end"))
            ident = (str(alert.get("event")), alert.get("start"))
            if start is None or end is None or end < now or ident in seen:
                continue
            seen.add(ident)
            alerts.append(
                WeatherAlert(
                    place=name,
                    event=str(alert.get("event") or "Weather alert"),
                    sender=alert.get("sender_name"),
                    start=start,
                    end=end,
                    description=alert.get("description"),
                )
            )

    return WeatherRead(
        configured=True,
        problem="; ".join(problems) or None,
        today=now_weather,
        days=days,
        alerts=alerts,
    )
