"""Query counts for the read paths (review.md 1C-3).

These are only possible with a real database — a fake session cannot tell you
how many round-trips a request makes. They pin the N+1 fixes in place: add a
per-row query somewhere and one of these fails.
"""

import pytest
from sqlalchemy import event

from tests.factories import make_day, make_location, make_point, make_stay, make_travel, make_trip


class QueryCounter:
    def __init__(self):
        self.statements: list[str] = []

    @property
    def selects(self) -> int:
        return sum(1 for s in self.statements if s.lstrip().upper().startswith("SELECT"))


@pytest.fixture
def count_queries(engine):
    """Count the SQL statements a block of code issues."""
    counter = QueryCounter()

    def before_cursor_execute(conn, cursor, statement, params, context, executemany):
        counter.statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", before_cursor_execute)
    yield counter
    event.remove(engine.sync_engine, "before_cursor_execute", before_cursor_execute)


async def _rich_trip(db, user, *, points_per_day=4, days=3):
    """A trip big enough that an N+1 would be obvious."""
    trip = await make_trip(db, user)
    for day_index in range(days):
        day = await make_day(db, trip, date=f"2026-10-{30 + day_index if day_index < 2 else 1:02d}")
        for point_index in range(points_per_day):
            stay = await make_stay(db, trip, name=f"Stay {day_index}-{point_index}")
            travel = await make_travel(db, trip, name=f"Travel {day_index}-{point_index}")
            await make_location(db, stay=stay, name="Naha")
            await make_location(db, travel=travel, role="origin", name="Seattle")
            point = await make_point(
                db,
                trip,
                day,
                title=f"Point {day_index}-{point_index}",
                stay_detail_id=stay.stay_detail_id if point_index % 2 == 0 else None,
                travel_detail_id=travel.travel_detail_id if point_index % 2 else None,
            )
            await make_location(db, point=point, name="Somewhere")
    return trip


class TestReadPathQueryCounts:
    async def test_list_points_does_not_scale_with_the_number_of_points(
        self, client, db, user, count_queries
    ):
        trip = await _rich_trip(db, user)  # 12 points, each with a stay or travel

        count_queries.statements.clear()
        resp = await client.get(f"/trips/{trip.trip_id}/points")

        assert resp.status_code == 200
        assert len(resp.json()) == 12
        # Batch-loaded: points, stays, travels, locations (+ the ownership check).
        # The old per-point loader issued up to 5 queries *per point*.
        assert count_queries.selects <= 8, count_queries.statements

    async def test_list_stay_details_is_two_queries_not_one_per_stay(
        self, client, db, user, count_queries
    ):
        trip = await _rich_trip(db, user)  # 12 stays, each with a location

        count_queries.statements.clear()
        resp = await client.get(f"/trips/{trip.trip_id}/stay-details")

        assert resp.status_code == 200
        assert len(resp.json()) == 12
        assert count_queries.selects <= 4, count_queries.statements

    async def test_list_travel_details_is_two_queries_not_one_per_travel(
        self, client, db, user, count_queries
    ):
        trip = await _rich_trip(db, user)

        count_queries.statements.clear()
        resp = await client.get(f"/trips/{trip.trip_id}/travel-details")

        assert resp.status_code == 200
        assert count_queries.selects <= 4, count_queries.statements

    async def test_get_trip_assembles_in_a_fixed_number_of_queries(
        self, client, db, user, count_queries
    ):
        """The whole trip — days, points, stays, travels, locations."""
        trip = await _rich_trip(db, user)

        count_queries.statements.clear()
        resp = await client.get(f"/trips/{trip.trip_id}")

        assert resp.status_code == 200
        body = resp.json()
        assert sum(len(d["points"]) for d in body["days"]) == 12

        # Fixed cost regardless of trip size: ownership + stays + travels +
        # their locations + days + points + point locations.
        assert count_queries.selects <= 10, count_queries.statements

    async def test_the_count_really_would_catch_an_n_plus_1(self, client, db, user, count_queries):
        """Sanity: a bigger trip must not cost proportionally more queries."""
        small = await make_trip(db, user, trip_name="Small")
        day = await make_day(db, small)
        await make_point(db, small, day)

        count_queries.statements.clear()
        await client.get(f"/trips/{small.trip_id}/points")
        small_cost = count_queries.selects

        big = await _rich_trip(db, user)
        count_queries.statements.clear()
        await client.get(f"/trips/{big.trip_id}/points")
        big_cost = count_queries.selects

        # 1 point vs 12 points: the query count must be flat, not 12x.
        assert big_cost <= small_cost + 2, (small_cost, big_cost)
