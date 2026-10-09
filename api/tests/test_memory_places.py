"""Place names for journal memories (Run stage 26): looked up on the server
after a memory with a location is saved, best effort, never in the way of
the save. Google is faked; `google_places_server`'s own parsing is tested
against canned responses."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import google_places_server
from app.google_places_server import NearbyPlace, area_of
from app.models import Memory
from app.sample_data import load_sample_trip
from app.services.memories import place_radius
from app.settings import get_app_settings
from tests.test_sharing import edited_trip

HERE = {"lat": 48.2104, "lng": 16.3655, "accuracy": 12.0}


class FakeLookup:
    def __init__(self, answer: NearbyPlace | None) -> None:
        self.answer = answer
        self.calls: list[tuple[float, float, float]] = []

    async def __call__(self, lat: float, lng: float, radius_m: float) -> NearbyPlace | None:
        self.calls.append((lat, lng, radius_m))
        return self.answer


@pytest.fixture
def lookup(monkeypatch: pytest.MonkeyPatch) -> FakeLookup:
    fake = FakeLookup(NearbyPlace(name="Café Central", area="Innere Stadt, Vienna"))
    monkeypatch.setattr(google_places_server, "nearby_place", fake)
    return fake


async def _trip(client: AsyncClient) -> str:
    return str((await client.post("/trips/import", json=load_sample_trip())).json()["id"])


async def _save(client: AsyncClient, tid: str, **extra: Any) -> dict[str, Any]:
    resp = await client.post(
        f"/trips/{tid}/memories", json={"text": "Melange", "zone": "Europe/Vienna", **extra}
    )
    assert resp.status_code in (200, 201), resp.text
    body: dict[str, Any] = resp.json()
    return body


async def test_a_memory_with_a_location_gets_its_place_named(
    client: AsyncClient, lookup: FakeLookup
) -> None:
    tid = await _trip(client)
    saved = await _save(client, tid, location=HERE)
    # The save answers before the lookup: no name yet in its own reply.
    assert saved["location"]["placeName"] is None
    assert lookup.calls == [(48.2104, 16.3655, 25.0)]  # ±12 m → the 25 m floor
    [listed] = (await client.get(f"/trips/{tid}/memories")).json()
    assert listed["location"] == {
        **HERE,
        "placeName": "Café Central",
        "placeArea": "Innere Stadt, Vienna",
    }


async def test_area_only_when_nothing_is_close(client: AsyncClient, lookup: FakeLookup) -> None:
    lookup.answer = NearbyPlace(name=None, area="Wieden, Vienna")
    tid = await _trip(client)
    await _save(client, tid, location=HERE)
    [listed] = (await client.get(f"/trips/{tid}/memories")).json()
    assert (listed["location"]["placeName"], listed["location"]["placeArea"]) == (
        None,
        "Wieden, Vienna",
    )


async def test_no_answer_still_saves(client: AsyncClient, lookup: FakeLookup) -> None:
    lookup.answer = None
    tid = await _trip(client)
    saved = await _save(client, tid, location=HERE)
    [listed] = (await client.get(f"/trips/{tid}/memories")).json()
    assert listed["id"] == saved["id"]
    assert listed["location"]["placeName"] is None


async def test_a_failing_lookup_never_fails_the_save(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(*_: Any) -> NearbyPlace:
        raise RuntimeError("Google is down")

    monkeypatch.setattr(google_places_server, "nearby_place", boom)
    tid = await _trip(client)
    await _save(client, tid, location=HERE)
    assert len((await client.get(f"/trips/{tid}/memories")).json()) == 1


async def test_no_location_no_lookup_and_a_retry_doesnt_look_again(
    client: AsyncClient, lookup: FakeLookup
) -> None:
    tid = await _trip(client)
    await _save(client, tid)
    assert lookup.calls == []
    first = await _save(client, tid, id="7d1c2f4e-0000-4000-8000-000000000001", location=HERE)
    await _save(client, tid, id=first["id"], location=HERE)  # the outbox retries
    assert len(lookup.calls) == 1


async def test_removing_the_location_removes_the_place(
    client: AsyncClient, lookup: FakeLookup
) -> None:
    tid = await _trip(client)
    saved = await _save(client, tid, location=HERE)
    dropped = (
        await client.put(
            f"/trips/{tid}/memories/{saved['id']}", json={"text": "x", "location": None}
        )
    ).json()
    assert dropped["location"] is None


async def test_a_phone_cannot_send_a_place_name(client: AsyncClient) -> None:
    tid = await _trip(client)
    resp = await client.post(
        f"/trips/{tid}/memories",
        json={"text": "x", "zone": "UTC", "location": {**HERE, "placeName": "Fake"}},
    )
    assert resp.status_code == 422


async def test_the_backfill_names_only_unnamed_memories(
    client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app import backfill_places

    none = FakeLookup(None)
    monkeypatch.setattr(google_places_server, "nearby_place", none)
    tid = await _trip(client)
    await _save(client, tid, location=HERE)  # saved while lookups found nothing
    await _save(client, tid)  # no location: never looked up
    fake = FakeLookup(NearbyPlace(name="Café Central", area=None))
    monkeypatch.setattr(google_places_server, "nearby_place", fake)
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)
    monkeypatch.setattr(backfill_places, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(backfill_places, "DELAY_SECONDS", 0)
    await backfill_places.main()
    await backfill_places.main()  # already named: not looked up again
    assert len(fake.calls) == 1
    names = {
        m["location"]["placeName"]
        for m in (await client.get(f"/trips/{tid}/memories")).json()
        if m["location"]
    }
    assert names == {"Café Central"}


async def test_author_ranks_give_owner_then_members_in_join_order(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    tid = (await edited_trip(client, viewer))["id"]
    await _save(client, tid)
    await _save(viewer, tid)
    ranks = {
        m["authorEmail"]: m["authorRank"]
        for m in (await client.get(f"/trips/{tid}/memories")).json()
    }
    assert ranks == {"user@example.com": 0, "pripri@example.com": 1}
    listed = (await client.get(f"/trips/{tid}/memories")).json()
    assert listed[0]["authorName"] == "Test User"


def test_the_search_radius_follows_the_phones_accuracy() -> None:
    assert place_radius(None) == 50
    assert place_radius(5) == 25
    assert place_radius(80) == 80
    assert place_radius(2000) == 150


def test_area_is_neighbourhood_then_town() -> None:
    parts = [
        {"longText": "1", "types": ["street_number"]},
        {"longText": "Innere Stadt", "types": ["sublocality_level_1", "sublocality", "political"]},
        {"longText": "Vienna", "types": ["locality", "political"]},
        {"longText": "Austria", "types": ["country", "political"]},
    ]
    assert area_of(parts) == "Innere Stadt, Vienna"
    assert area_of([{"longText": "Wengen", "types": ["locality"]}]) == "Wengen"
    assert area_of([]) is None


def _google(handler: Any) -> Any:
    real = httpx.AsyncClient

    def client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    return client


CAFE = {
    "displayName": {"text": "Café Central"},
    "types": ["cafe", "food", "establishment"],
    "userRatingCount": 30415,
    "addressComponents": [
        {"longText": "Innere Stadt", "types": ["sublocality_level_1"]},
        {"longText": "Vienna", "types": ["locality"]},
    ],
}
GYM = {  # closer, but you probably weren't there
    "displayName": {"text": "Vigor Health and Performance"},
    "types": ["gym"],
    "addressComponents": [{"longText": "Vienna", "types": ["locality"]}],
}
DISTRICT = {
    "displayName": {"text": "Innere Stadt"},
    "types": ["sublocality", "political"],
    "addressComponents": [
        {"longText": "Innere Stadt", "types": ["sublocality_level_1"]},
        {"longText": "Vienna", "types": ["locality"]},
    ],
}


async def test_nearby_place_names_the_most_reviewed_real_place(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "k")
    sent: list[Any] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"places": [DISTRICT, GYM, CAFE]})

    monkeypatch.setattr(httpx, "AsyncClient", _google(handler))
    found = await google_places_server.nearby_place(48.21, 16.36, 40)
    assert found == NearbyPlace(name="Café Central", area="Innere Stadt, Vienna")
    assert sent[0].headers["X-Goog-Api-Key"] == "k"
    assert b'"radius":40' in sent[0].content.replace(b" ", b"")


async def test_nearby_place_falls_back_to_the_area(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "k")
    answers = [{"places": []}, {"places": [DISTRICT]}]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=answers.pop(0))

    monkeypatch.setattr(httpx, "AsyncClient", _google(handler))
    found = await google_places_server.nearby_place(48.21, 16.36, 40)
    assert found == NearbyPlace(name=None, area="Innere Stadt, Vienna")


async def test_nearby_place_swallows_errors_and_needs_a_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert await google_places_server.nearby_place(1, 2, 30) is None  # no key
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "k")
    monkeypatch.setattr(httpx, "AsyncClient", _google(lambda request: httpx.Response(403, json={})))
    assert await google_places_server.nearby_place(1, 2, 30) is None


async def test_memory_rows_keep_the_names(
    client: AsyncClient, db: AsyncSession, lookup: FakeLookup
) -> None:
    tid = await _trip(client)
    saved = await _save(client, tid, location=HERE)
    async with async_sessionmaker(db.bind, expire_on_commit=False)() as other:
        row = await other.get(Memory, uuid.UUID(saved["id"]))
        assert row is not None and row.place_name == "Café Central"
