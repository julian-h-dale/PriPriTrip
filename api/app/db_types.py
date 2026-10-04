"""Custom SQLAlchemy column types shared across models.

The whole class of timezone bugs comes from one ``datetime`` type doing two
different jobs. Keep them separate:

- **Instants** (``completed_at``, ``created_at``) are stored aware, in UTC —
  use :class:`UtcDateTime`.
- **Wall-clock** values ("this routine ends at 09:00") have no offset; attaching
  one corrupts them. Model those as a plain ``time`` (see ``WallClockTime`` in
  ``schemas.py`` for the wire-boundary guard).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UtcDateTime(TypeDecorator):
    """An instant, always read back tz-aware in UTC.

    SQLite has no native timezone type, so a bare ``DateTime(timezone=True)``
    silently drops ``tzinfo`` on write. A value written and re-read in the same
    session then serialises with a ``Z`` while the same row re-read from the
    database serialises without one — the wire format depends on the identity
    map, which no client should see. This normalises both directions.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: object) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)

    # Same normalisation in both directions.
    def process_result_value(self, value: datetime | None, dialect: object) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
