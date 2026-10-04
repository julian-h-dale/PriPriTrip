"""The timezone rule: a time's clock comes from where it happens."""

from __future__ import annotations

import datetime as dt

from app.sample_data import load_sample_trip
from app.trip_document import TripDocumentError, validate_trip_document
from app.zones import arrive_zone, depart_zone, item_zone, night_stay, stay_zone, zone_at

ZURICH = {"name": "Zürich Airport", "lat": 47.4581, "lng": 8.5555}
OHARE = {"name": "O'Hare", "lat": 41.9786, "lng": -87.9048}
NAHA = {"name": "Naha Airport", "lat": 26.1967, "lng": 127.649}


def test_zone_at_coordinates() -> None:
    assert zone_at(47.4581, 8.5555) == "Europe/Zurich"
    assert zone_at(41.9786, -87.9048) == "America/Chicago"
    assert zone_at(43.508, 16.439) == "Europe/Zagreb"
    assert zone_at(26.2124, 127.6809) == "Asia/Tokyo"


def _trip(**changes: object) -> dict[str, object]:
    doc = load_sample_trip()
    doc.update(changes)
    return doc


def test_travel_ends_use_their_own_places() -> None:
    doc = validate_trip_document(load_sample_trip())
    flight = doc.travels[0]  # O'Hare -> Zürich, both with coordinates
    assert depart_zone(flight, doc.timezone) == "America/Chicago"
    assert arrive_zone(flight, doc.timezone) == "Europe/Zurich"


def test_coordinates_win_over_an_explicit_zone() -> None:
    raw = load_sample_trip()
    raw["travels"][0]["departTimezone"] = "Asia/Tokyo"  # wrong, but coords say Chicago
    doc = validate_trip_document(raw)
    assert depart_zone(doc.travels[0], doc.timezone) == "America/Chicago"


def test_explicit_zone_applies_only_without_coordinates() -> None:
    raw = load_sample_trip()
    train = raw["travels"][1]  # Zürich Flughafen -> Bern: names only
    train["departTimezone"] = "Europe/Vienna"
    doc = validate_trip_document(raw)
    assert depart_zone(doc.travels[1], doc.timezone) == "Europe/Vienna"
    assert arrive_zone(doc.travels[1], doc.timezone) == "Europe/Zurich"  # trip fallback


def test_stay_uses_its_place() -> None:
    raw = load_sample_trip()
    raw["stays"][0]["location"] = {"name": "Naha hotel", **{k: NAHA[k] for k in ("lat", "lng")}}
    doc = validate_trip_document(raw)
    assert stay_zone(doc.stays[0], doc.timezone) == "Asia/Tokyo"


def test_activity_without_a_place_uses_its_nights_stay() -> None:
    raw = load_sample_trip()
    # Move the Bern stay to Okinawa; the untitled walk that day has no place.
    raw["stays"][0]["location"] = {"name": "Naha hotel", "lat": NAHA["lat"], "lng": NAHA["lng"]}
    doc = validate_trip_document(raw)
    day = doc.days[0]  # 2026-05-11
    walk = day.items[1]  # "Old Town & Zytglogge walk": no location
    assert walk.location is None
    assert item_zone(walk, day.date, doc.stays, doc.timezone) == "Asia/Tokyo"
    lunch = day.items[0]  # has its own coordinates in Bern
    assert item_zone(lunch, day.date, doc.stays, doc.timezone) == "Europe/Zurich"


def test_night_stay_prefers_the_night_then_the_morning_checkout() -> None:
    doc = validate_trip_document(load_sample_trip())
    bern, wengen = doc.stays
    assert night_stay(doc.stays, dt.date(2026, 5, 11)) is bern
    assert night_stay(doc.stays, dt.date(2026, 5, 12)) is wengen  # sleeps in Wengen
    assert night_stay(doc.stays, dt.date(2026, 5, 14)) is wengen  # checks out that morning
    assert night_stay(doc.stays, dt.date(2026, 5, 10)) is None


def test_activity_with_no_stay_uses_the_trip_zone() -> None:
    doc = validate_trip_document(_trip(timezone="Europe/Paris", stays=[]))
    walk = doc.days[0].items[1]
    assert item_zone(walk, doc.days[0].date, doc.stays, doc.timezone) == "Europe/Paris"


def test_rules_compare_travel_on_each_places_clock() -> None:
    raw = load_sample_trip()
    # Naha -> Zürich: 10:00 Tokyo is 03:00 Zürich, so landing at 02:00 Zürich is
    # before take-off even though the wall clocks alone look fine on the next day.
    raw["travels"][0].update(
        {
            "from": NAHA,
            "to": ZURICH,
            "departTimezone": None,
            "depart": "2026-05-11T10:00",
            "arrive": "2026-05-11T02:00",
        }
    )
    try:
        validate_trip_document(raw)
    except TripDocumentError as exc:
        assert [e.path for e in exc.errors] == ["travels[0].arrive"]
    else:
        raise AssertionError("expected the arrival to be rejected")

    raw["travels"][0]["arrive"] = "2026-05-11T04:00"  # 11:00 Tokyo: fine
    validate_trip_document(raw)


def test_travel_from_is_required() -> None:
    raw = load_sample_trip()
    del raw["travels"][1]["from"]
    try:
        validate_trip_document(raw)
    except TripDocumentError as exc:
        assert [e.path for e in exc.errors] == ["travels[1].from"]
    else:
        raise AssertionError("expected a missing from to be rejected")
