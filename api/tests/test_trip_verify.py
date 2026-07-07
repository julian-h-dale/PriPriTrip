from app.schemas import (
    StayDetail,
    TripDayWithPoints,
    TripPointResponse,
    TripResponse,
)
from app.services.trip_verify import verify_trip


def _point(point_id: str, day_id: str, ptype: str = "activity") -> TripPointResponse:
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


def _stay(check_in: str, check_out: str) -> StayDetail:
    return StayDetail(
        stayDetailId="s1",
        tripId="trip_1",
        name="Hotel Test",
        stayType="hotel",
        checkIn=check_in,
        checkOut=check_out,
    )


def _trip(days, stays=None, start="2026-05-10", end="2026-05-12") -> TripResponse:
    return TripResponse(
        tripId="trip_1",
        tripName="Test Trip",
        startDate=start,
        endDate=end,
        stays=stays or [],
        days=days,
    )


def test_clean_trip_has_no_issues():
    trip = _trip(
        [
            _day("d1", "2026-05-10", [_point("p1", "d1", "check-in")]),
            _day("d2", "2026-05-11", [_point("p2", "d2")]),
            _day("d3", "2026-05-12", [_point("p3", "d3", "check-out")]),
        ],
        stays=[_stay("2026-05-10T15:00:00", "2026-05-12T11:00:00")],
    )
    result = verify_trip(trip)
    assert result.ok is True
    assert result.issues == []
    assert result.daysChecked == 3


def test_empty_day_flagged():
    trip = _trip(
        [
            _day("d1", "2026-05-10", [_point("p1", "d1", "check-in")]),
            _day("d2", "2026-05-11", []),  # empty
            _day("d3", "2026-05-12", [_point("p3", "d3", "check-out")]),
        ],
        stays=[_stay("2026-05-10T15:00:00", "2026-05-12T11:00:00")],
    )
    result = verify_trip(trip)
    codes = [(i.code, i.date) for i in result.issues]
    assert ("EMPTY_DAY", "2026-05-11") in codes
    assert result.ok is False


def test_missing_day_in_range_flagged():
    trip = _trip(
        [
            _day("d1", "2026-05-10", [_point("p1", "d1", "check-in")]),
            _day("d3", "2026-05-12", [_point("p3", "d3", "check-out")]),
        ],
        stays=[_stay("2026-05-10T15:00:00", "2026-05-12T11:00:00")],
    )
    result = verify_trip(trip)
    empty = [i for i in result.issues if i.code == "EMPTY_DAY"]
    assert len(empty) == 1
    assert empty[0].date == "2026-05-11"
    assert empty[0].dayId is None


def test_missing_stay_warning_when_uncovered():
    trip = _trip(
        [
            _day("d1", "2026-05-10", [_point("p1", "d1", "check-in")]),
            _day("d2", "2026-05-11", [_point("p2", "d2")]),  # not covered by stay
            _day("d3", "2026-05-12", [_point("p3", "d3", "check-out")]),
        ],
        stays=[_stay("2026-05-10T15:00:00", "2026-05-10T23:00:00")],  # covers only the 10th
    )
    result = verify_trip(trip)
    warnings = [i for i in result.issues if i.code == "MISSING_STAY"]
    warn_dates = {w.date for w in warnings}
    assert "2026-05-11" in warn_dates
    assert "2026-05-12" in warn_dates
    assert all(w.severity == "warning" for w in warnings)


def test_empty_day_not_double_flagged():
    trip = _trip(
        [
            _day("d1", "2026-05-10", [_point("p1", "d1", "check-in")]),
            _day("d2", "2026-05-11", []),
            _day("d3", "2026-05-12", [_point("p3", "d3", "check-out")]),
        ],
        stays=[_stay("2026-05-10T15:00:00", "2026-05-10T23:00:00")],
    )
    result = verify_trip(trip)
    for_11 = [i for i in result.issues if i.date == "2026-05-11"]
    assert len(for_11) == 1
    assert for_11[0].code == "EMPTY_DAY"
