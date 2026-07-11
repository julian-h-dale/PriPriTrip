from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import re

_WEEKDAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}
_MONTH_INDEX = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


@dataclass
class DateNormalizerInput:
    rawText: str
    appCurrentDate: str
    tripStartDate: str | None = None
    tripEndDate: str | None = None
    activeDayDate: str | None = None


def _next_weekday(anchor: date, target_weekday: int) -> date:
    delta = (target_weekday - anchor.weekday()) % 7
    if delta == 0:
        delta = 7
    return anchor + timedelta(days=delta)


def _month_day_next_occurrence(anchor: date, month: int, day: int) -> date | None:
    try:
        candidate = date(anchor.year, month, day)
    except ValueError:
        return None
    if candidate < anchor:
        try:
            return date(anchor.year + 1, month, day)
        except ValueError:
            return None
    return candidate


def normalize_date(value: DateNormalizerInput) -> str | None:
    raw = (value.rawText or "").strip()
    if not raw:
        return None

    anchor = date.fromisoformat(value.appCurrentDate)

    explicit = re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw)
    if explicit:
        return raw

    lowered = raw.lower()
    if lowered == "today":
        return anchor.isoformat()
    if lowered == "tomorrow":
        return (anchor + timedelta(days=1)).isoformat()

    if lowered in _WEEKDAY_INDEX:
        return _next_weekday(anchor, _WEEKDAY_INDEX[lowered]).isoformat()

    month_day_match = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2})", raw)
    if month_day_match:
        month = _MONTH_INDEX.get(month_day_match.group(1).lower())
        if month is None:
            return None
        day = int(month_day_match.group(2))
        candidate = _month_day_next_occurrence(anchor, month, day)
        if candidate is None:
            return None

        if value.tripStartDate and value.tripEndDate:
            try:
                start = date.fromisoformat(value.tripStartDate)
                end = date.fromisoformat(value.tripEndDate)
            except ValueError:
                start = end = None
            if start and end and start <= candidate <= end:
                return candidate.isoformat()

        return candidate.isoformat()

    md_numeric = re.fullmatch(r"(\d{1,2})/(\d{1,2})", raw)
    if md_numeric:
        month = int(md_numeric.group(1))
        day = int(md_numeric.group(2))
        candidate = _month_day_next_occurrence(anchor, month, day)
        return candidate.isoformat() if candidate else None

    # Time-only handling is managed by point/stay/travel handlers where active day
    # context exists; this helper returns None for non-date strings.
    return None
