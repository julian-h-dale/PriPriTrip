"""Deterministic, offline trip verification (no OpenAI).

Checks a fully-assembled trip against stay and travel criteria:
    - INCOMPLETE_STAY (error): a stay is missing check-in or check-out.
    - MISSING_STAY (warning): a date in [startDate, endDate] is not covered by any stay.
    - EMPTY_DAY (warning): a date in [startDate, endDate] has no day record or no points.
    - TRAVEL_INCOMPLETE_DATES (error): a travel leg is missing departure or arrival time.
    - TRAVEL_INCOMPLETE_LOCATIONS (error): a travel leg is missing origin or destination.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app.schemas import TripResponse, VerifyIssue, VerifyResult


def _parse_date(value) -> date:
    """Trip/day dates are real `date`s; wall-clock times are still ISO text."""
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _date_range(start, end) -> list[date]:
    start_d = _parse_date(start)
    end_d = _parse_date(end)
    if end_d < start_d:
        return [start_d]
    days = []
    current = start_d
    while current <= end_d:
        days.append(current)
        current += timedelta(days=1)
    return days


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _stay_covered_dates(trip: TripResponse) -> set[date]:
    """Dates covered by any trip-level stay (check-in..check-out inclusive)."""
    covered: set[date] = set()
    for stay in getattr(trip, "stays", []) or []:
        if not stay.check_in or not stay.check_out:
            continue
        try:
            start = _parse_date(stay.check_in)
            end = _parse_date(stay.check_out)
        except ValueError:
            continue
        if end < start:
            continue
        current = start
        while current <= end:
            covered.add(current)
            current += timedelta(days=1)
    return covered


def verify_trip(trip: TripResponse) -> VerifyResult:
    # Group (non-alternate) days by their date.
    days_by_date: dict[date, list] = {}
    for day in trip.days:
        if getattr(day, "is_alternate", False):
            continue
        try:
            key = _parse_date(day.date)
        except ValueError:
            continue
        days_by_date.setdefault(key, []).append(day)

    covered = _stay_covered_dates(trip)
    issues: list[VerifyIssue] = []
    all_dates = _date_range(trip.start_date, trip.end_date)
    trip_start = _parse_date(trip.start_date)
    trip_end = _parse_date(trip.end_date)

    # Stay completeness checks.
    for stay in getattr(trip, "stays", []) or []:
        if not (stay.check_in and stay.check_out):
            stay_date = trip.start_date
            if stay.check_in:
                stay_date = stay.check_in[:10]
            elif stay.check_out:
                stay_date = stay.check_out[:10]
            issues.append(
                VerifyIssue(
                    code="INCOMPLETE_STAY",
                    severity="error",
                    date=stay_date,
                    message=(
                        "INCOMPLETE_STAY: Stay is missing check-in or check-out date. "
                        "Provide both dates."
                    ),
                )
            )

        if stay.check_in:
            check_in_date = _parse_date(stay.check_in)
            if check_in_date < trip_start:
                issues.append(
                    VerifyIssue(
                        code="STAY_OUTOFBOUNDS",
                        severity="error",
                        date=stay.check_in[:10],
                        message="STAY_OUTOFBOUNDS: Stay check-in falls before the trip start date.",
                    )
                )
            if check_in_date > trip_end:
                issues.append(
                    VerifyIssue(
                        code="STAY_OUTOFBOUNDS",
                        severity="error",
                        date=stay.check_in[:10],
                        message="STAY_OUTOFBOUNDS: Stay check-in falls after the trip end date.",
                    )
                )
        if stay.check_out:
            check_out_date = _parse_date(stay.check_out)
            if check_out_date < trip_start:
                issues.append(
                    VerifyIssue(
                        code="STAY_OUTOFBOUNDS",
                        severity="error",
                        date=stay.check_out[:10],
                        message="STAY_OUTOFBOUNDS: Stay check-out falls before the trip start date.",
                    )
                )
            if check_out_date > trip_end:
                issues.append(
                    VerifyIssue(
                        code="STAY_OUTOFBOUNDS",
                        severity="error",
                        date=stay.check_out[:10],
                        message="STAY_OUTOFBOUNDS: Stay check-out falls after the trip end date.",
                    )
                )

    # Travel completeness checks.
    for travel in getattr(trip, "travels", []) or []:
        travel_date = trip.start_date
        if travel.departure_date_time:
            travel_date = travel.departure_date_time[:10]
        elif travel.arrival_date_time:
            travel_date = travel.arrival_date_time[:10]

        if not (travel.departure_date_time and travel.arrival_date_time):
            issues.append(
                VerifyIssue(
                    code="TRAVEL_INCOMPLETE_DATES",
                    severity="error",
                    date=travel_date,
                    message=(
                        "TRAVEL_INCOMPLETE_DATES: Travel leg is missing departure "
                        "or arrival time. Provide both times."
                    ),
                )
            )

        roles = {getattr(loc, "role", None) for loc in (travel.locations or [])}
        if not ({"origin", "destination"} <= roles):
            issues.append(
                VerifyIssue(
                    code="TRAVEL_INCOMPLETE_LOCATIONS",
                    severity="error",
                    date=travel_date,
                    message=(
                        "TRAVEL_INCOMPLETE_LOCATIONS: Travel leg is missing origin "
                        "or destination location. Provide both locations."
                    ),
                )
            )

        if travel.departure_date_time:
            departure_date = _parse_date(travel.departure_date_time)
            if departure_date < trip_start:
                issues.append(
                    VerifyIssue(
                        code="TRAVEL_OUTOFBOUNDS",
                        severity="error",
                        date=travel.departure_date_time[:10],
                        message="TRAVEL_OUTOFBOUNDS: Travel departure falls before the trip start date.",
                    )
                )
            if departure_date > trip_end:
                issues.append(
                    VerifyIssue(
                        code="TRAVEL_OUTOFBOUNDS",
                        severity="error",
                        date=travel.departure_date_time[:10],
                        message="TRAVEL_OUTOFBOUNDS: Travel departure falls after the trip end date.",
                    )
                )
        if travel.arrival_date_time:
            arrival_date = _parse_date(travel.arrival_date_time)
            if arrival_date < trip_start:
                issues.append(
                    VerifyIssue(
                        code="TRAVEL_OUTOFBOUNDS",
                        severity="error",
                        date=travel.arrival_date_time[:10],
                        message="TRAVEL_OUTOFBOUNDS: Travel arrival falls before the trip start date.",
                    )
                )
            if arrival_date > trip_end:
                issues.append(
                    VerifyIssue(
                        code="TRAVEL_OUTOFBOUNDS",
                        severity="error",
                        date=travel.arrival_date_time[:10],
                        message="TRAVEL_OUTOFBOUNDS: Travel arrival falls after the trip end date.",
                    )
                )

    ordered_travels = []
    for travel in getattr(trip, "travels", []) or []:
        if not travel.departure_date_time or not travel.arrival_date_time:
            continue
        try:
            ordered_travels.append((travel, _parse_datetime(travel.departure_date_time), _parse_datetime(travel.arrival_date_time)))
        except ValueError:
            continue
    ordered_travels.sort(key=lambda item: item[1])
    latest_arrival: datetime | None = None
    for travel, departure_dt, arrival_dt in ordered_travels:
        if latest_arrival is not None and departure_dt < latest_arrival:
            issues.append(
                VerifyIssue(
                    code="TRAVEL_OVERLAP",
                    severity="error",
                    date=travel.departure_date_time[:10],
                    message="TRAVEL_OVERLAP: Travel departure overlaps a preceding arrival.",
                )
            )
        if latest_arrival is None or arrival_dt > latest_arrival:
            latest_arrival = arrival_dt

    ordered_stays = []
    for stay in getattr(trip, "stays", []) or []:
        if not stay.check_in or not stay.check_out:
            continue
        try:
            ordered_stays.append((stay, _parse_datetime(stay.check_in), _parse_datetime(stay.check_out)))
        except ValueError:
            continue
    ordered_stays.sort(key=lambda item: item[1])
    latest_checkout: datetime | None = None
    for stay, check_in_dt, check_out_dt in ordered_stays:
        if latest_checkout is not None and check_in_dt < latest_checkout:
            issues.append(
                VerifyIssue(
                    code="STAY_OVERLAP",
                    severity="error",
                    date=stay.check_in[:10],
                    message="STAY_OVERLAP: Stay check-in overlaps a previous stay checkout.",
                )
            )
        if latest_checkout is None or check_out_dt > latest_checkout:
            latest_checkout = check_out_dt

    for d in all_dates:
        iso = d.isoformat()
        day_records = days_by_date.get(d, [])
        points = [p for day in day_records for p in (day.points or [])]
        first_day_id = day_records[0].day_id if day_records else None

        if not points:
            issues.append(
                VerifyIssue(
                    code="EMPTY_DAY",
                    severity="warning",
                    date=iso,
                    dayId=first_day_id,
                    message="EMPTY_DAY: No plans found for this day.",
                )
            )

        if d not in covered:
            issues.append(
                VerifyIssue(
                    code="MISSING_STAY",
                    severity="warning",
                    date=iso,
                    dayId=first_day_id,
                    message="MISSING_STAY: No stay covers this trip day.",
                )
            )

    return VerifyResult(
        ok=len(issues) == 0,
        daysChecked=len(all_dates),
        issues=issues,
    )
