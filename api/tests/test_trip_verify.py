from app.schemas import (
    LocationResponse,
    StayDetail,
    TravelDetail,
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


def _stay(check_in: str | None, check_out: str | None) -> StayDetail:
    return StayDetail(
        stayDetailId="s1",
        tripId="trip_1",
        name="Hotel Test",
        stayType="hotel",
        checkIn=check_in,
        checkOut=check_out,
    )


def _travel(
    departure: str | None,
    arrival: str | None,
    *,
    include_origin: bool = True,
    include_destination: bool = True,
) -> TravelDetail:
    locations = []
    if include_origin:
        locations.append(
            LocationResponse(
                locationId="loc-origin",
                travelDetailId="t1",
                role="origin",
                name="Origin",
            )
        )
    if include_destination:
        locations.append(
            LocationResponse(
                locationId="loc-dest",
                travelDetailId="t1",
                role="destination",
                name="Destination",
            )
        )
    return TravelDetail(
        travelDetailId="t1",
        tripId="trip_1",
        name="Train Leg",
        mode="train",
        departureDateTime=departure,
        arrivalDateTime=arrival,
        locations=locations,
    )


def _trip(days, stays=None, travels=None, start="2026-05-10", end="2026-05-12") -> TripResponse:
    return TripResponse(
        tripId="trip_1",
        tripName="Test Trip",
        startDate=start,
        endDate=end,
        stays=stays or [],
        travels=travels or [],
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
        travels=[_travel("2026-05-10T09:00:00", "2026-05-10T12:00:00")],
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
    empty = [i for i in result.issues if i.code == "EMPTY_DAY" and i.date == "2026-05-11"]
    assert len(empty) == 1
    assert empty[0].severity == "warning"
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
    assert empty[0].severity == "warning"


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


def test_empty_day_and_missing_stay_are_both_reported():
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
    codes = {i.code for i in for_11}
    assert "EMPTY_DAY" in codes
    assert "MISSING_STAY" in codes


def test_incomplete_stay_raises_error():
    trip = _trip(
        [_day("d1", "2026-05-10", [_point("p1", "d1")])],
        stays=[_stay("2026-05-10T15:00:00", None)],
        start="2026-05-10",
        end="2026-05-10",
    )
    result = verify_trip(trip)
    issues = [i for i in result.issues if i.code == "INCOMPLETE_STAY"]
    assert len(issues) == 1
    assert issues[0].severity == "error"
    assert "INCOMPLETE_STAY" in issues[0].message


def test_travel_missing_dates_raises_error():
    trip = _trip(
        [_day("d1", "2026-05-10", [_point("p1", "d1")])],
        stays=[_stay("2026-05-10T15:00:00", "2026-05-10T23:00:00")],
        travels=[_travel("2026-05-10T09:00:00", None)],
        start="2026-05-10",
        end="2026-05-10",
    )
    result = verify_trip(trip)
    issues = [i for i in result.issues if i.code == "TRAVEL_INCOMPLETE_DATES"]
    assert len(issues) == 1
    assert issues[0].severity == "error"
    assert "TRAVEL_INCOMPLETE_DATES" in issues[0].message


def test_travel_missing_locations_raises_error():
    trip = _trip(
        [_day("d1", "2026-05-10", [_point("p1", "d1")])],
        stays=[_stay("2026-05-10T15:00:00", "2026-05-10T23:00:00")],
        travels=[
            _travel(
                "2026-05-10T09:00:00",
                "2026-05-10T12:00:00",
                include_origin=True,
                include_destination=False,
            )
        ],
        start="2026-05-10",
        end="2026-05-10",
    )
    result = verify_trip(trip)
    issues = [i for i in result.issues if i.code == "TRAVEL_INCOMPLETE_LOCATIONS"]
    assert len(issues) == 1
    assert issues[0].severity == "error"
    assert "TRAVEL_INCOMPLETE_LOCATIONS" in issues[0].message
