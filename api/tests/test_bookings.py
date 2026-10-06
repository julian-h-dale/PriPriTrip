"""Editing stays and travel, zones in the read model, /config and /timezone."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.sample_data import load_sample_trip
from app.settings import get_app_settings
from tests.conftest import if_match

Json = dict[str, Any]

ZURICH_AIRPORT = {
    "name": "Zürich Airport",
    "lat": 47.4581,
    "lng": 8.5555,
    "placeId": "ChIJz",
    "city": "Kloten",
    "imgRef": "https://places.googleapis.com/v1/places/ChIJz/photos/abc/media",
}
SPLIT = {"name": "Split Airport", "lat": 43.5389, "lng": 16.298}
NAHA = {"name": "Naha Airport", "lat": 26.1967, "lng": 127.649}


@pytest.fixture
async def trip(client: AsyncClient) -> Json:
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    body: Json = (await client.get(f"/trips/{trip_id}")).json()
    return body


def stay_named(trip: Json, name: str) -> Json:
    return next(s for s in trip["stays"] if s["name"] == name)


def travel_titled(trip: Json, title: str) -> Json:
    return next(t for t in trip["travels"] if t["title"] == title)


# ---- zones in the read model ----


async def test_read_model_shows_each_times_clock(trip: Json) -> None:
    flight = travel_titled(trip, "Chicago → Zürich")
    assert (flight["departZone"], flight["arriveZone"]) == ("America/Chicago", "Europe/Zurich")
    train = travel_titled(trip, "Zürich Airport → Bern")  # names only: trip zone
    assert (train["departZone"], train["arriveZone"]) == ("Europe/Zurich", "Europe/Zurich")
    # Durations come from the times on their own clocks: 17:40 Chicago → 9:25 Zürich.
    assert (flight["durationMinutes"], train["durationMinutes"]) == (525, 60)
    assert stay_named(trip, "Beausite Park Hotel")["zone"] == "Europe/Zurich"
    walk = trip["days"][0]["items"][1]
    assert walk["title"] == "Old Town & Zytglogge walk" and walk["zone"] == "Europe/Zurich"


async def test_zones_follow_a_stay_edit(client: AsyncClient, trip: Json) -> None:
    """Computed on read, never stored: moving the stay moves its night's activities."""
    bern = stay_named(trip, "Hotel Goldener Schlüssel")
    body = {
        "name": "Hotel Goldener Schlüssel",
        "checkIn": bern["checkIn"],
        "checkOut": bern["checkOut"],
        "location": {"name": "Naha hotel", "lat": NAHA["lat"], "lng": NAHA["lng"]},
    }
    updated = (
        await client.put(f"/trips/{trip['id']}/stays/{bern['id']}", json=body, headers=if_match(1))
    ).json()
    assert stay_named(updated, "Hotel Goldener Schlüssel")["zone"] == "Asia/Tokyo"
    walk = updated["days"][0]["items"][1]  # no place of its own
    assert walk["zone"] == "Asia/Tokyo"


# ---- stays ----


async def test_create_stay(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/stays",
        json={
            "name": "Airport hotel",
            "type": "hotel",
            "checkIn": "2026-05-13T22:00",
            "checkOut": "2026-05-14T09:00",
            "location": ZURICH_AIRPORT,
            "roomType": "Twin",
            "confirmationNumber": "AH-1",
        },
    )
    assert resp.status_code == 201, resp.text
    added = stay_named(resp.json(), "Airport hotel")
    assert added["location"]["placeId"] == "ChIJz"
    assert added["location"]["city"] == "Kloten"
    assert added["location"]["imgRef"] == ZURICH_AIRPORT["imgRef"]
    assert added["roomType"] == "Twin"
    assert added["zone"] == "Europe/Zurich"


async def test_stay_requires_check_in_and_out(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/stays", json={"name": "Somewhere", "checkIn": "2026-05-11T15:00"}
    )
    assert resp.status_code == 422
    assert [e["path"] for e in resp.json()["errors"]] == ["checkOut"]
    assert resp.json()["detail"] == "The stay has 1 problem."


async def test_stay_rules_match_import(client: AsyncClient, trip: Json) -> None:
    bad = {"name": "x", "checkIn": "2026-05-09T15:00", "checkOut": "2026-05-09T11:00"}
    edited = (await client.post(f"/trips/{trip['id']}/stays", json=bad)).json()["errors"]
    doc = load_sample_trip()
    doc["stays"] = [bad]
    imported = (await client.post("/trips/import", json=doc)).json()["errors"]
    assert [(e["path"], e["message"]) for e in edited] == [
        (e["path"].removeprefix("stays[0]."), e["message"]) for e in imported
    ]


async def test_replace_and_delete_stay(client: AsyncClient, trip: Json) -> None:
    bern = stay_named(trip, "Hotel Goldener Schlüssel")
    replaced = await client.put(
        f"/trips/{trip['id']}/stays/{bern['id']}",
        json={"name": "Hotel Bern", "checkIn": bern["checkIn"], "checkOut": bern["checkOut"]},
        headers=if_match(1),
    )
    assert replaced.status_code == 200
    renamed = next(s for s in replaced.json()["stays"] if s["id"] == bern["id"])
    assert renamed["name"] == "Hotel Bern"
    assert renamed["version"] == 2
    assert "location" not in renamed and "confirmationNumber" not in renamed  # full replace

    deleted = await client.delete(f"/trips/{trip['id']}/stays/{bern['id']}", headers=if_match(2))
    assert deleted.status_code == 200
    assert all(s["id"] != bern["id"] for s in deleted.json()["stays"])
    assert (await client.delete(f"/trips/{trip['id']}/stays/{bern['id']}")).status_code == 404


# ---- travel ----


async def test_create_travel_without_an_arrival(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/travels",
        json={
            "title": "Zürich → Split",
            "mode": "flight",
            "carrier": "Croatia Airlines",
            "number": "OU 461",
            "seat": "4C",
            "from": ZURICH_AIRPORT,
            "depart": "2026-05-13T16:05",
        },
    )
    assert resp.status_code == 201, resp.text
    leg = travel_titled(resp.json(), "Zürich → Split")
    assert leg["seat"] == "4C"
    assert "arrive" not in leg and "to" not in leg  # allowed; the UI warns


async def test_travel_requires_type_from_and_departure(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(f"/trips/{trip['id']}/travels", json={"title": "Somewhere"})
    assert resp.status_code == 422
    assert {e["path"] for e in resp.json()["errors"]} == {"mode", "from", "depart"}


async def test_boat_is_a_travel_type(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/travels",
        json={
            "title": "Lake cruise",
            "mode": "boat",
            "from": {"name": "Interlaken West"},
            "depart": "2026-05-13T14:00",
        },
    )
    assert resp.status_code == 201


async def test_travel_arrival_is_checked_on_its_own_clock(client: AsyncClient, trip: Json) -> None:
    body = {
        "title": "Naha → Zürich",
        "mode": "flight",
        "from": NAHA,
        "to": ZURICH_AIRPORT,
        "depart": "2026-05-11T10:00",  # 03:00 in Zürich
        "arrive": "2026-05-11T02:00",  # an hour before take-off
    }
    resp = await client.post(f"/trips/{trip['id']}/travels", json=body)
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["path"] == "arrive"
    body["arrive"] = "2026-05-11T18:00"
    assert (await client.post(f"/trips/{trip['id']}/travels", json=body)).status_code == 201


async def test_replace_and_delete_travel(client: AsyncClient, trip: Json) -> None:
    train = travel_titled(trip, "Bern → Wengen")
    resp = await client.put(
        f"/trips/{trip['id']}/travels/{train['id']}",
        json={
            "title": "Bern → Wengen (later train)",
            "mode": "train",
            "from": {"name": "Bern"},
            "to": {"name": "Wengen"},
            "depart": "2026-05-12T12:34",
            "arrive": "2026-05-12T14:41",
        },
        headers=if_match(1),
    )
    assert resp.status_code == 200
    moved = travel_titled(resp.json(), "Bern → Wengen (later train)")
    assert moved["id"] == train["id"] and moved["depart"] == "2026-05-12T12:34"

    resp = await client.delete(f"/trips/{trip['id']}/travels/{train['id']}", headers=if_match(2))
    assert all(t["id"] != train["id"] for t in resp.json()["travels"])


# ---- ownership ----


async def test_booking_on_another_trip_is_a_404(client: AsyncClient, trip: Json) -> None:
    other = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    stay_id = trip["stays"][0]["id"]
    travel_id = trip["travels"][0]["id"]
    assert (await client.delete(f"/trips/{other}/stays/{stay_id}")).status_code == 404
    assert (await client.delete(f"/trips/{other}/travels/{travel_id}")).status_code == 404
    assert (await client.delete(f"/trips/{trip['id']}/stays/{uuid.uuid4()}")).status_code == 404


async def test_anonymous_booking_edits_are_rejected(anon_client: AsyncClient) -> None:
    trip_id = uuid.uuid4()
    assert (await anon_client.post(f"/trips/{trip_id}/stays", json={})).status_code == 401
    assert (await anon_client.post(f"/trips/{trip_id}/travels", json={})).status_code == 401


# ---- config / timezone ----


async def test_config_returns_the_maps_key(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "browser-key")
    monkeypatch.setattr(get_app_settings(), "google_maps_map_id", "map-id")
    assert (await client.get("/config")).json() == {
        "googleMapsApiKey": "browser-key",
        "googleMapsMapId": "map-id",
    }
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "")
    monkeypatch.setattr(get_app_settings(), "google_maps_map_id", "")
    assert (await client.get("/config")).json() == {
        "googleMapsApiKey": None,
        "googleMapsMapId": None,
    }


async def test_config_and_timezone_need_a_user(anon_client: AsyncClient) -> None:
    assert (await anon_client.get("/config")).status_code == 401
    assert (await anon_client.get("/timezone?lat=47.45&lng=8.55")).status_code == 401


async def test_timezone_at_a_place(client: AsyncClient) -> None:
    resp = await client.get("/timezone", params={"lat": 41.9786, "lng": -87.9048})
    assert resp.json() == {"timezone": "America/Chicago"}
    assert (await client.get("/timezone", params={"lat": 123, "lng": 0})).status_code == 422
