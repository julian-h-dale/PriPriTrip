"""Deterministic, offline trip verification (no OpenAI).

Checks a fully-assembled trip against stay and travel criteria:
    - INCOMPLETE_STAY (error): a stay is missing check-in or check-out.
    - MISSING_STAY (warning): a date in [startDate, endDate] is not covered by any stay.
    - EMPTY_DAY (warning): a date in [startDate, endDate] has no day record or no points.
    - TRAVEL_INCOMPLETE_DATES (error): a travel leg is missing departure or arrival time.
    - TRAVEL_INCOMPLETE_LOCATIONS (error): a travel leg is missing origin or destination.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.schemas import TripResponse, VerifyIssue, VerifyResult


def _parse_date(value: str) -> date:
    # Dates are stored as ISO "YYYY-MM-DD"; take the date part defensively.
    return date.fromisoformat(value[:10])


def _date_range(start: str, end: str) -> list[date]:
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


def _stay_covered_dates(trip: TripResponse) -> set[date]:
    """Dates covered by any trip-level stay (check-in..check-out inclusive)."""
    covered: set[date] = set()
    for stay in getattr(trip, "stays", []) or []:
        if not stay.checkIn or not stay.checkOut:
            continue
        try:
            start = _parse_date(stay.checkIn)
            end = _parse_date(stay.checkOut)
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
        if getattr(day, "isAlternate", False):
            continue
        try:
            key = _parse_date(day.date)
        except ValueError:
            continue
        days_by_date.setdefault(key, []).append(day)

    covered = _stay_covered_dates(trip)
    issues: list[VerifyIssue] = []
    all_dates = _date_range(trip.startDate, trip.endDate)

    # Stay completeness checks.
    for stay in getattr(trip, "stays", []) or []:
        if stay.checkIn and stay.checkOut:
            continue
        stay_date = trip.startDate
        if stay.checkIn:
            stay_date = stay.checkIn[:10]
        elif stay.checkOut:
            stay_date = stay.checkOut[:10]
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

    # Travel completeness checks.
    for travel in getattr(trip, "travels", []) or []:
        travel_date = trip.startDate
        if travel.departureDateTime:
            travel_date = travel.departureDateTime[:10]
        elif travel.arrivalDateTime:
            travel_date = travel.arrivalDateTime[:10]

        if not (travel.departureDateTime and travel.arrivalDateTime):
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

    for d in all_dates:
        iso = d.isoformat()
        day_records = days_by_date.get(d, [])
        points = [p for day in day_records for p in (day.points or [])]
        first_day_id = day_records[0].dayId if day_records else None

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
