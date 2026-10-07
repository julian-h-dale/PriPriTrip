"""Optimistic concurrency for a trip's entries (days, activities, stays, travel).

Several people can edit a trip, so every change to an entry must say which
version of it the change was made from, in an `If-Match` header. If someone
else changed (or deleted) it since, the write is refused with 409 and the
entry's current state, instead of silently overwriting their change. The app
then shows who changed it and reloads; nothing is merged.

- `parse_if_match` reads the header. No header is 428: only an out-of-date
  app sends none, and letting it through could overwrite someone's change.
- `check` compares the version and raises the 409.
- `stamp` records a change: the next version, when, and by whom.

Adding an entry needs no version (there's nothing to conflict with), and
moving an activity up or down only renumbers positions, so it isn't a
content change and isn't versioned. A day that has no row yet (an untitled
date) is version 0.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Any

from fastapi import HTTPException, status

from app.models import Day, Item, PointOfInterest, Stay, Travel

Versioned = Day | Item | PointOfInterest | Stay | Travel

# An ETag as RFC 9110 writes it ("3" or W/"3"), or a bare number.
_ETAG = re.compile(r'^\s*(?:W/)?"?(\d{1,9})"?\s*$')


def parse_if_match(header: str | None) -> int:
    """The version an If-Match header names. 428 when there's none; 400 when
    it isn't a version this API gave out."""
    if header is None or not header.strip():
        raise HTTPException(
            status.HTTP_428_PRECONDITION_REQUIRED,
            "This change needs the version it was made from (If-Match). "
            "The app may be out of date: close and reopen it.",
        )
    match = _ETAG.match(header)
    if match is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'If-Match must be a version, like "3"')
    return int(match.group(1))


def check(
    entity: Versioned | None,
    expected: int,
    *,
    current: dict[str, Any] | None,
    updated_by_name: str | None,
) -> None:
    """Refuse the write (409) unless `entity` is still at `expected`. A missing
    entity (a day with no row yet) is version 0. `current` is the entry as the
    trip reads it now, and `updated_by_name` who last changed it, both sent
    back so the app can say who got there first."""
    actual = entity.version if entity is not None else 0
    if actual == expected:
        return
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        {
            "message": "Someone else changed this while you were editing it.",
            "version": actual,
            "updatedAt": entity.updated_at.isoformat() if entity and entity.updated_at else None,
            "updatedByName": updated_by_name,
            "current": current,
        },
    )


def stamp(entity: Versioned, user_id: uuid.UUID, *, new: bool = False) -> None:
    """Record a change to `entity`: its next version, now, and who made it."""
    entity.version = 1 if new else entity.version + 1
    entity.updated_at = dt.datetime.now(dt.UTC)
    entity.updated_by = user_id
