"""Trip weather (Phase 50), with OpenWeatherMap replaced by a fake: each
day's place, forecast vs outlook vs past, the 12-hour cache, stale data on a
failed refresh, one call per key under concurrency, and no key at all."""

from __future__ import annotations

import asyncio
import datetime as dt
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import WeatherCache
from app.services import weather as weather_service
from app.settings import get_app_settings
from app.trip_document import TripDocument
from tests.test_sharing import edited_trip, shared_trip

NAHA = {"name": "Hotel Palm Royal", "city": "Naha", "lat": 26.2164, "lng": 127.6899}
TOKASHIKI = {
    "name": "Tokashiku Marine Village",
    "city": "Tokashiki",
    "lat": 26.1858,
    "lng": 127.3479,
}
TAIPEI = {"name": "Taoyuan Airport", "city": "Taipei", "lat": 25.0797, "lng": 121.2342}
CHICAGO = {"name": "O'Hare", "city": "Chicago", "lat": 41.9742, "lng": -87.9073}


def _day(offset: int) -> dt.date:
    """A date relative to today in Okinawa (where the test trip is)."""
    return dt.datetime.now(dt.UTC).astimezone(
        dt.timezone(dt.timedelta(hours=9))
    ).date() + dt.timedelta(days=offset)


def _wall(day: dt.date, hhmm: str = "15:00") -> str:
    return f"{day.isoformat()}T{hhmm}"


def trip_doc(start: int, length: int = 12) -> dict[str, Any]:
    """Day 0: fly Chicago → Taipei (lands that day). Days 1 to 4 in Naha, 5 on
    Tokashiki, then nothing booked (stays in Tokashiki's weather)."""
    s = _day(start)
    d = lambda n: s + dt.timedelta(days=n)  # noqa: E731
    return {
        "schemaVersion": 1,
        "name": "Weather test trip",
        "startDate": s.isoformat(),
        "endDate": d(length - 1).isoformat(),
        "timezone": "Asia/Tokyo",
        "stays": [
            {
                "name": "Palm Royal",
                "checkIn": _wall(d(1)),
                "checkOut": _wall(d(5), "11:00"),
                "location": NAHA,
            },
            {
                "name": "Marine Village",
                "checkIn": _wall(d(5)),
                "checkOut": _wall(d(6), "10:00"),
                "location": TOKASHIKI,
            },
        ],
        "travels": [
            {
                "title": "Fly to Taipei",
                "mode": "flight",
                "from": CHICAGO,
                "to": TAIPEI,
                "depart": _wall(d(0), "00:30"),
                "arrive": _wall(d(0), "20:00"),
            }
        ],
        "days": [],
    }


def _owm_daily(day: dt.date, high: float) -> dict[str, Any]:
    noon = dt.datetime.combine(day, dt.time(3), dt.UTC)  # noon in UTC+9
    return {
        "dt": int(noon.timestamp()),
        "sunrise": int(noon.timestamp()) - 6 * 3600,
        "sunset": int(noon.timestamp()) + 6 * 3600,
        "summary": "Expect a day of partly cloudy with rain",
        "temp": {"min": high - 6, "max": high, "day": high - 1},
        "feels_like": {"day": high + 1},
        "humidity": 70,
        "wind_speed": 5.5,
        "wind_gust": 9.0,
        "clouds": 40,
        "pop": 0.35,
        "rain": 2.4,
        "uvi": 7.1,
        "weather": [{"main": "Rain", "description": "light rain", "icon": "10d"}],
    }


class FakeOWM:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail: str | None = None
        self.alerts: list[dict[str, Any]] = []

    async def __call__(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((path, params))
        await asyncio.sleep(0)
        if self.fail:
            raise weather_service.WeatherFetchError(self.fail)
        if path == "/onecall":
            return {
                "timezone_offset": 9 * 3600,
                "current": {
                    "dt": int(dt.datetime.now(dt.UTC).timestamp()),
                    "temp": 27.5,
                    "feels_like": 30.1,
                    "humidity": 75,
                    "wind_speed": 4.0,
                    "uvi": 6.0,
                    "weather": [{"main": "Clouds", "description": "broken clouds", "icon": "04d"}],
                },
                "daily": [_owm_daily(_day(n), 28 + n) for n in range(8)],
                "alerts": self.alerts,
            }
        assert path == "/onecall/day_summary"
        return {
            "date": params["date"],
            "temperature": {"min": 21.0, "max": 26.5},
            "precipitation": {"total": 3.2},
            # As OWM really sends them (seen live 2026-10-05): decimals.
            "humidity": {"afternoon": 80.46},
            "cloud_cover": {"afternoon": 97.94},
            "wind": {"max": {"speed": 7.7, "direction": 30}},
        }

    def paths(self) -> list[str]:
        return [p for p, _ in self.calls]


@pytest.fixture
def owm(monkeypatch: pytest.MonkeyPatch) -> FakeOWM:
    fake = FakeOWM()
    monkeypatch.setattr(weather_service, "_get", fake)
    monkeypatch.setattr(get_app_settings(), "openweather_api_key", "test-key")
    return fake


async def _import(client: AsyncClient, doc: dict[str, Any]) -> str:
    resp = await client.post("/trips/import", json=doc)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


def test_each_day_takes_where_you_sleep_else_where_you_land_else_the_day_before() -> None:
    trip = TripDocument.model_validate(trip_doc(30))
    places = weather_service.day_places(trip)
    names = [p.name if p else None for p in places.values()]
    assert names == ["Taipei"] + ["Naha"] * 4 + ["Tokashiki"] * 7


def test_days_before_any_place_take_the_first_one() -> None:
    doc = trip_doc(30)
    doc["travels"] = []
    trip = TripDocument.model_validate(doc)
    names = [p.name if p else None for p in weather_service.day_places(trip).values()]
    assert names[:2] == ["Naha", "Naha"]


async def test_no_key_means_not_configured_and_no_calls(
    client: AsyncClient, owm: FakeOWM, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_app_settings(), "openweather_api_key", "")
    tid = await _import(client, trip_doc(2))
    resp = await client.get(f"/trips/{tid}/weather")
    assert resp.status_code == 200
    assert resp.json() == {
        "configured": False,
        "problem": None,
        "today": None,
        "days": [],
        "alerts": [],
    }
    assert owm.calls == []


async def test_forecast_for_the_next_8_days_then_the_outlook(
    client: AsyncClient, owm: FakeOWM
) -> None:
    tid = await _import(client, trip_doc(2))  # starts the day after tomorrow
    body = (await client.get(f"/trips/{tid}/weather")).json()
    assert body["configured"] and body["problem"] is None
    days = body["days"]
    assert len(days) == 12
    # Trip days 0 to 5 are 2 to 7 days out: forecast. Later ones: the outlook.
    assert [d["kind"] for d in days] == ["forecast"] * 6 + ["outlook"] * 6
    first = days[1]  # Naha, 3 days out
    assert first["place"] == "Naha"
    assert first["zone"] == "Asia/Tokyo"
    assert (first["high"], first["low"], first["pop"], first["rain"]) == (31, 25, 0.35, 2.4)
    assert (first["condition"], first["icon"], first["uvi"]) == ("Rain", "10d", 7.1)
    assert days[0]["place"] == "Taipei"
    outlook = days[-1]
    assert (outlook["high"], outlook["low"], outlook["rain"], outlook["windSpeed"]) == (
        26.5,
        21.0,
        3.2,
        7.7,
    )
    assert outlook["icon"] is None
    assert (outlook["humidity"], outlook["clouds"]) == (80, 98)
    # Before the trip, "today" is the first day's place right now.
    assert body["today"]["place"] == "Taipei"
    assert body["today"]["temp"] == 27.5
    # One /onecall per place in the forecast window, one day_summary per later day.
    assert sorted(owm.paths()).count("/onecall") == 3  # Taipei, Naha, Tokashiki
    summaries = [p for p, params in owm.calls if p == "/onecall/day_summary"]
    assert len(summaries) == 6
    assert all(params["tz"] == "+09:00" for p, params in owm.calls if p == "/onecall/day_summary")


async def test_past_days_get_nothing_and_today_follows_the_trip(
    client: AsyncClient, owm: FakeOWM
) -> None:
    tid = await _import(client, trip_doc(-3))  # started three days ago
    body = (await client.get(f"/trips/{tid}/weather")).json()
    assert [d["kind"] for d in body["days"][:3]] == ["past"] * 3
    assert body["days"][3]["kind"] == "forecast"
    assert body["today"]["place"] == "Naha"  # trip day 3


async def test_after_the_trip_there_is_no_today(client: AsyncClient, owm: FakeOWM) -> None:
    tid = await _import(client, trip_doc(-20))
    body = (await client.get(f"/trips/{tid}/weather")).json()
    assert {d["kind"] for d in body["days"]} == {"past"}
    assert body["today"] is None
    assert owm.calls == []


async def test_a_fresh_cache_makes_no_calls_and_an_old_one_refreshes(
    client: AsyncClient, owm: FakeOWM, db: AsyncSession
) -> None:
    tid = await _import(client, trip_doc(2))
    await client.get(f"/trips/{tid}/weather")
    first = len(owm.calls)
    await client.get(f"/trips/{tid}/weather")
    assert len(owm.calls) == first  # all from the cache

    await db.execute(
        update(WeatherCache).values(fetched_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=13))
    )
    await db.commit()
    await client.get(f"/trips/{tid}/weather")
    assert len(owm.calls) == 2 * first


async def test_a_failed_refresh_serves_the_stale_copy(
    client: AsyncClient, owm: FakeOWM, db: AsyncSession
) -> None:
    tid = await _import(client, trip_doc(2))
    await client.get(f"/trips/{tid}/weather")
    await db.execute(
        update(WeatherCache).values(fetched_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=13))
    )
    await db.commit()
    owm.fail = "OpenWeatherMap answered 500"
    body = (await client.get(f"/trips/{tid}/weather")).json()
    assert body["problem"] == "OpenWeatherMap answered 500"
    assert body["days"][1]["kind"] == "forecast"
    assert body["days"][1]["stale"] is True
    assert body["today"]["stale"] is True


async def test_nothing_cached_and_no_answer_is_unavailable_not_an_error(
    client: AsyncClient, owm: FakeOWM
) -> None:
    owm.fail = "OpenWeatherMap refused the key (it needs the One Call 3.0 subscription)"
    tid = await _import(client, trip_doc(2))
    resp = await client.get(f"/trips/{tid}/weather")
    assert resp.status_code == 200
    body = resp.json()
    assert {d["kind"] for d in body["days"]} == {"unavailable"}
    assert body["today"] is None
    assert "One Call 3.0" in body["problem"]


async def test_two_requests_at_once_make_one_call_per_key(owm: FakeOWM, db: AsyncSession) -> None:
    now = dt.datetime.now(dt.UTC)

    sessions = async_sessionmaker(db.bind, expire_on_commit=False)

    async def fetch() -> Any:
        async with sessions() as session:
            return await weather_service._cached(
                session, "onecall:1.00,2.00", "/onecall", {"lat": 1, "lon": 2}, now, []
            )

    results = await asyncio.gather(fetch(), fetch(), fetch())
    assert all(r is not None for r in results)
    assert owm.paths() == ["/onecall"]


async def test_alerts_come_through_once(client: AsyncClient, owm: FakeOWM) -> None:
    start = dt.datetime.now(dt.UTC)
    owm.alerts = [
        {
            "sender_name": "Japan Meteorological Agency",
            "event": "Typhoon warning",
            "start": int(start.timestamp()),
            "end": int((start + dt.timedelta(days=1)).timestamp()),
            "description": "Strong winds.",
        },
        {"event": "Old", "start": 0, "end": 1},  # already over: dropped
    ]
    tid = await _import(client, trip_doc(2))
    alerts = (await client.get(f"/trips/{tid}/weather")).json()["alerts"]
    assert [a["event"] for a in alerts] == ["Typhoon warning"]  # same alert from 3 places: once
    assert alerts[0]["sender"] == "Japan Meteorological Agency"


async def test_editors_see_it_viewers_and_strangers_dont(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient, owm: FakeOWM
) -> None:
    """Weather is a Trip tool: the owner and editors (Run stage 17)."""
    trip = await shared_trip(client, viewer)
    assert (await client.get(f"/trips/{trip['id']}/weather")).status_code == 200
    assert (await viewer.get(f"/trips/{trip['id']}/weather")).status_code == 403
    assert (await stranger.get(f"/trips/{trip['id']}/weather")).status_code == 404
    edited = await edited_trip(client, stranger)  # `stranger` joins another as an editor
    assert (await stranger.get(f"/trips/{edited['id']}/weather")).status_code == 200
