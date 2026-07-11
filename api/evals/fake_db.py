"""In-memory stand-in for the async SQLAlchemy session.

Same pattern as tests/test_chat_tool_loop.py: rows are keyed by table name,
`get()` works by (model, pk), and WHERE clauses are ignored — good enough for
the executor paths the chat tools exercise. Evals run against this instead of
PostgreSQL so a live eval needs only an OpenAI key.
"""

from __future__ import annotations

from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
)

_PK_ATTR = {
    TripRecord: "trip_id",
    TripDayRecord: "day_id",
    TripPointRecord: "point_id",
    StayDetailRecord: "stay_detail_id",
    TravelDetailRecord: "travel_detail_id",
    LocationRecord: "location_id",
}


class FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return list(self._items)

    def scalar_one(self):
        # Only used for the select(func.count()) trip-summary queries.
        return len(self._items)


class FakeSession:
    def __init__(self):
        self.rows: dict[str, list] = {}
        self._store: dict = {}

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, stmt):
        try:
            table = stmt.get_final_froms()[0].name
        except Exception:
            # DELETE statements (location replacement) land here.
            table = getattr(getattr(stmt, "table", None), "name", None)
        return FakeResult(self.rows.get(table, []))

    async def flush(self):
        return None

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None

    def add(self, obj):
        self.rows.setdefault(obj.__table__.name, []).append(obj)
        pk_attr = _PK_ATTR.get(type(obj))
        if pk_attr:
            self._store[(type(obj), getattr(obj, pk_attr))] = obj

    def active_count(self, table: str) -> int:
        """Rows not soft-deleted (is_deleted may be None pre-flush)."""
        return sum(
            1
            for row in self.rows.get(table, [])
            if not getattr(row, "is_deleted", False) and getattr(row, "deleted_at", None) is None
        )
