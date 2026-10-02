"""The trip document: structure, cross-field rules, and the published schema."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from app.sample_data import load_sample_trip
from app.schema_export import SCHEMA_PATH, render_schema
from app.trip_document import (
    TripDocumentError,
    trip_json_schema,
    validate_trip_document,
)

Doc = dict[str, Any]


def errors_for(doc: Doc) -> list[tuple[str, str]]:
    with pytest.raises(TripDocumentError) as exc:
        validate_trip_document(doc)
    return [(e.path, e.message) for e in exc.value.errors]


def paths_for(doc: Doc) -> list[str]:
    return [path for path, _ in errors_for(doc)]


# ---- happy path ----


def test_sample_trip_is_valid() -> None:
    doc = validate_trip_document(load_sample_trip())
    assert doc.name == "Bern & Wengen Long Weekend"
    assert len(doc.stays) == 2
    assert len(doc.travels) == 4
    assert [d.title for d in doc.days] == ["Arrive in Bern", "Up to Wengen", "Männlichen ridge"]


def test_minimal_document_is_valid() -> None:
    doc = validate_trip_document(
        {
            "schemaVersion": 1,
            "name": "Weekend",
            "startDate": "2026-06-01",
            "endDate": "2026-06-01",
            "timezone": "UTC",
        }
    )
    assert doc.stays == [] and doc.travels == [] and doc.days == []


def test_wall_clock_round_trips_in_the_document_format() -> None:
    doc = validate_trip_document(load_sample_trip())
    dumped = doc.model_dump(mode="json", by_alias=True, exclude_none=True)
    assert dumped["stays"][0]["checkIn"] == "2026-05-11T14:00"
    assert dumped["travels"][0]["from"]["name"] == "Chicago O'Hare (ORD)"
    assert dumped == load_sample_trip()


# ---- structural errors carry paths ----


def test_unknown_field_is_rejected_with_its_path() -> None:
    doc = load_sample_trip()
    doc["days"][0]["items"][1]["startTime"] = "10:00"
    [(path, message)] = errors_for(doc)
    assert path == "days[0].items[1].startTime"
    assert "unknown field" in message


@pytest.mark.parametrize("value", ["2026-05-11T14:00+02:00", "2026-05-11T14:00Z", "14:00", 1])
def test_wall_clock_rejects_offsets_and_non_strings(value: object) -> None:
    doc = load_sample_trip()
    doc["stays"][0]["checkIn"] = value
    assert paths_for(doc) == ["stays[0].checkIn"]


def test_bad_timezone_is_rejected() -> None:
    doc = load_sample_trip()
    doc["travels"][0]["departTimezone"] = "Chicago"
    [(path, message)] = errors_for(doc)
    assert path == "travels[0].departTimezone"
    assert "IANA" in message


def test_missing_required_fields_are_all_reported() -> None:
    doc = load_sample_trip()
    del doc["name"]
    del doc["travels"][1]["depart"]
    assert sorted(paths_for(doc)) == ["name", "travels[1].depart"]


def test_unknown_travel_mode_is_rejected() -> None:
    doc = load_sample_trip()
    doc["travels"][1]["mode"] = "teleport"
    assert paths_for(doc) == ["travels[1].mode"]


# ---- cross-field rules: one failing case per rule ----


def _set(path_setter: Callable[[Doc], None]) -> Doc:
    doc = load_sample_trip()
    path_setter(doc)
    return doc


RULE_CASES: list[tuple[str, Callable[[Doc], None], str]] = [
    # (1) end before start
    ("rule1", lambda d: d.update(endDate="2026-05-09"), "endDate"),
    # (2) day outside the trip / duplicate day
    ("rule2-range", lambda d: d["days"][0].update(date="2026-05-20"), "days[0].date"),
    ("rule2-dup", lambda d: d["days"][1].update(date="2026-05-11"), "days[1].date"),
    # (3) activity on the wrong date / end before start / end without start
    (
        "rule3-date",
        lambda d: d["days"][0]["items"][0].update(start="2026-05-12T12:15"),
        "days[0].items[0].start",
    ),
    (
        "rule3-order",
        lambda d: d["days"][0]["items"][0].update(end="2026-05-11T11:00"),
        "days[0].items[0].end",
    ),
    (
        "rule3-no-start",
        lambda d: d["days"][0]["items"][1].update(end="2026-05-11T16:00"),
        "days[0].items[1].end",
    ),
    # (4) stay check-out before check-in / outside the trip
    (
        "rule4-order",
        lambda d: d["stays"][0].update(checkOut="2026-05-11T13:00"),
        "stays[0].checkOut",
    ),
    ("rule4-in", lambda d: d["stays"][0].update(checkIn="2026-05-09T14:00"), "stays[0].checkIn"),
    ("rule4-out", lambda d: d["stays"][1].update(checkOut="2026-05-16T10:00"), "stays[1].checkOut"),
    # (5) travel outside the trip / arrive before depart
    (
        "rule5-range",
        lambda d: d["travels"][1].update(depart="2026-05-15T10:28"),
        "travels[1].depart",
    ),
    (
        "rule5-order",
        lambda d: d["travels"][1].update(arrive="2026-05-11T10:00"),
        "travels[1].arrive",
    ),
    # (7) coordinates come in pairs and in range
    ("rule7-pair", lambda d: d["stays"][0]["location"].pop("lng"), "stays[0].location"),
    ("rule7-range", lambda d: d["stays"][0]["location"].update(lat=123), "stays[0].location.lat"),
]


@pytest.mark.parametrize(("name", "mutate", "path"), RULE_CASES, ids=[c[0] for c in RULE_CASES])
def test_rule_violation_is_reported_at_its_path(
    name: str, mutate: Callable[[Doc], None], path: str
) -> None:
    assert path in paths_for(_set(mutate))


def test_inverted_trip_dates_report_only_that() -> None:
    doc = load_sample_trip()
    doc["endDate"] = "2026-05-01"
    assert paths_for(doc) == ["endDate"]


def test_cross_zone_arrival_is_compared_as_an_instant() -> None:
    # Chicago 17:40 → Zürich 09:25 next day: the wall clocks alone would also
    # pass, so make the arrival *earlier on the wall* but later in reality.
    doc = load_sample_trip()
    doc["travels"][0].update(depart="2026-05-11T01:00", arrive="2026-05-11T07:30")
    # 01:00 Chicago = 06:00 UTC; 07:30 Zürich = 05:30 UTC → arrives "before" it left.
    assert paths_for(doc) == ["travels[0].arrive"]

    doc["travels"][0].update(arrive="2026-05-11T08:30")  # 06:30 UTC: fine
    validate_trip_document(doc)


def test_all_rule_violations_are_reported_together() -> None:
    doc = load_sample_trip()
    doc["days"][0]["date"] = "2026-05-20"
    doc["stays"][0]["checkOut"] = "2026-05-11T13:00"
    doc["travels"][1]["arrive"] = "2026-05-11T10:00"
    # Moving the day also strands its timed activities, which are reported too.
    assert {"days[0].date", "stays[0].checkOut", "travels[1].arrive"} <= set(paths_for(doc))


def test_trip_end_plus_one_is_allowed_for_checkout_and_arrival() -> None:
    doc = load_sample_trip()
    doc["stays"][1]["checkOut"] = "2026-05-15T10:00"
    doc["travels"][3]["arrive"] = "2026-05-15T08:00"
    validate_trip_document(doc)


# ---- the published JSON Schema ----


def test_committed_schema_matches_the_models() -> None:
    assert (
        SCHEMA_PATH.read_text(encoding="utf-8") == render_schema()
    ), "schema/trip.schema.json is stale — run `make schema`"


def test_sample_trip_validates_against_the_json_schema() -> None:
    validator = Draft202012Validator(trip_json_schema())
    assert list(validator.iter_errors(load_sample_trip())) == []


def test_json_schema_rejects_unknown_fields_and_offsets() -> None:
    validator = Draft202012Validator(trip_json_schema())
    doc = load_sample_trip()
    doc["days"][0]["items"][0]["startTime"] = "12:15"
    doc["stays"][0]["checkIn"] = "2026-05-11T14:00+02:00"
    assert len(list(validator.iter_errors(doc))) == 2


def test_json_schema_documents_the_rules() -> None:
    assert "endDate is on or after startDate" in trip_json_schema()["description"]
