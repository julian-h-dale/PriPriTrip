from app.schemas import (
    TripDayWithPoints,
    TripPointResponse,
    TripResponse,
)
from app.services.trip_verify import verify_trip


def _point(point_id: str, day_id: str, ptype: str) -> TripPointResponse:
    return TripPointResponse(
        pointId=point_id,
        tripId="trip_1",
        dayId=day_id,
        type=ptype,
        title=f"{ptype} point",
        startDateTime="2026-05-10T09:00:00+02:00",
        endDateTime="2026-05-10T10:00:00+02:00",
        completed=False,
    )


def _day(day_id: str, date: str, points, is_alternate: bool = False) -> TripDayWithPoints:
    return TripDayWithPoints(
        dayId=day_id,
        tripId="trip_1",
        title=f"Day {date}",
        date=date,
        isAlternate=is_alternate,
        completed=False,
        points=points,
    )


def _trip(days, start="2026-05-10", end="2026-05-12") -> TripResponse:
    return TripResponse(
        tripId="trip_1",
        tripName="Test Trip",
        startDate=start,
        endDate=end,
        days=days,
    )


def test_clean_trip_has_no_issues():
    trip = _trip([
        _day("d1", "2026-05-10", [_point("p1", "d1", "stay"), _point("p2", "d1", "activity")]),
        _day("d2", "2026-05-11", [_point("p3", "d2", "stay")]),
        _day("d3", "2026-05-12", [_point("p4", "d3", "stay")]),
    ])
    result = verify_trip(trip)
    assert result.ok is True
    assert result.issues == []
    assert result.daysChecked == 3


def test_empty_day_flagged():
    trip = _trip([
        _day("d1", "2026-05-10", [_point("p1", "d1", "stay")]),
        _day("d2", "2026-05-11", []),  # empty legs
        _day("d3", "2026-05-12", [_point("p4", "d3", "stay")]),
    ])
    result = verify_trip(trip)
    codes = [(i.code, i.date) for i in result.issues]
    assert ("EMPTY_DAY", "2026-05-11") in codes
    assert result.ok is False


def test_missing_day_in_range_flagged():
    # 2026-05-11 has no day record at all.
    trip = _trip([
        _day("d1", "2026-05-10", [_point("p1", "d1", "stay")]),
        _day("d3", "2026-05-12", [_point("p4", "d3", "stay")]),
    ])
    result = verify_trip(trip)
    empty = [i for i in result.issues if i.code == "EMPTY_DAY"]
    assert len(empty) == 1
    assert empty[0].date == "2026-05-11"
    assert empty[0].dayId is None


def test_missing_stay_warning():
    trip = _trip([
        _day("d1", "2026-05-10", [_point("p1", "d1", "stay")]),
        _day("d2", "2026-05-11", [_point("p2", "d2", "activity")]),  # has plans, no stay
        _day("d3", "2026-05-12", [_point("p4", "d3", "stay")]),
    ])
    result = verify_trip(trip)
    warnings = [i for i in result.issues if i.code == "MISSING_STAY"]
    assert len(warnings) == 1
    assert warnings[0].severity == "warning"
    assert warnings[0].date == "2026-05-11"


def test_empty_day_not_double_flagged_with_stay_warning():
    trip = _trip([
        _day("d1", "2026-05-10", [_point("p1", "d1", "stay")]),
        _day("d2", "2026-05-11", []),
        _day("d3", "2026-05-12", [_point("p4", "d3", "stay")]),
    ])
    result = verify_trip(trip)
    for_11 = [i for i in result.issues if i.date == "2026-05-11"]
    assert len(for_11) == 1
    assert for_11[0].code == "EMPTY_DAY"


def test_alternate_days_ignored_for_coverage():
    # Only an alternate day exists on 05-11 -> treated as no real plans.
    trip = _trip([
        _day("d1", "2026-05-10", [_point("p1", "d1", "stay")]),
        _day("d2alt", "2026-05-11", [_point("p2", "d2alt", "activity")], is_alternate=True),
        _day("d3", "2026-05-12", [_point("p4", "d3", "stay")]),
    ])
    result = verify_trip(trip)
    empty = [i for i in result.issues if i.code == "EMPTY_DAY" and i.date == "2026-05-11"]
    assert len(empty) == 1
