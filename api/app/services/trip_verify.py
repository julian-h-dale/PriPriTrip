"""Deterministic, offline trip verification (no OpenAI).

Checks a fully-assembled trip against two criteria over its date range:
  - EMPTY_DAY  (error):   a date in [startDate, endDate] with no day record, or a
                          day whose points are empty -> no plans found for that day.
  - MISSING_STAY (warning): a date not covered by any trip-level stay
                          (check-in..check-out), surfaced so the user can confirm
                          accommodation coverage manually.

De-duplication: an empty day only yields EMPTY_DAY (no stay warning).
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

    for d in all_dates:
        iso = d.isoformat()
        day_records = days_by_date.get(d, [])
        points = [p for day in day_records for p in (day.points or [])]
        first_day_id = day_records[0].dayId if day_records else None

        if not points:
            issues.append(
                VerifyIssue(
                    code="EMPTY_DAY",
                    severity="error",
                    date=iso,
                    dayId=first_day_id,
                    message="No plans found for this day.",
                )
            )
            continue

        if d not in covered:
            issues.append(
                VerifyIssue(
                    code="MISSING_STAY",
                    severity="warning",
                    date=iso,
                    dayId=first_day_id,
                    message="No accommodation (stay) covers this day. Confirm coverage.",
                )
            )

    return VerifyResult(
        ok=len(issues) == 0,
        daysChecked=len(all_dates),
        issues=issues,
    )
