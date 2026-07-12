"""The test database itself: isolation and real constraints (review.md 1C-3)."""

from datetime import date
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import TripRecord, active

from tests.factories import make_day, make_location, make_point, make_stay, make_trip


async def _trip_count(db) -> int:
    return int((await db.execute(select(func.count()).select_from(TripRecord))).scalar_one())


class TestIsolation:
    """Each test gets a clean database; nothing leaks between them."""

    async def test_first_test_writes_a_trip(self, db, user):
        await make_trip(db, user, trip_name="Leaky Trip")
        assert await _trip_count(db) == 1

    async def test_second_test_does_not_see_it(self, db, user):
        assert await _trip_count(db) == 0

    async def test_a_committed_write_is_still_rolled_back(self, db, user):
        await make_trip(db, user)
        await db.commit()  # endpoints commit; the outer transaction still unwinds it
        assert await _trip_count(db) == 1

    async def test_and_the_commit_did_not_survive_either(self, db, user):
        assert await _trip_count(db) == 0


class TestRealConstraints:
    """Things the fake sessions could never have caught."""

    async def test_foreign_key_to_users_is_enforced(self, db):
        db.add(
            TripRecord(
                trip_id=str(uuid.uuid4()),
                user_id=str(uuid.uuid4()),  # no such user
                trip_name="Orphan",
                start_date=date(2026, 10, 30),
                end_date=date(2026, 11, 5),
            )
        )
        with pytest.raises(IntegrityError):
            await db.flush()

    async def test_a_location_with_no_owner_is_rejected(self, db, user):
        # num_nonnulls(point_id, stay_detail_id, travel_detail_id) = 1
        with pytest.raises(IntegrityError):
            await make_location(db, name="Nowhere")

    async def test_a_location_with_two_owners_is_rejected(self, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(db, trip)
        day = await make_day(db, trip)
        point = await make_point(db, trip, day)

        with pytest.raises(IntegrityError):
            await make_location(db, stay=stay, point=point)

    async def test_a_location_with_one_owner_is_accepted(self, db, user):
        trip = await make_trip(db, user)
        stay = await make_stay(db, trip)

        location = await make_location(db, stay=stay)

        assert location.stay_detail_id == stay.stay_detail_id
        assert location.point_id is None

    async def test_where_clauses_actually_filter(self, db, user):
        """The fake session returned every row of a table regardless of WHERE."""
        await make_trip(db, user, trip_name="Live")
        await make_trip(db, user, trip_name="Deleted", is_deleted=True)

        rows = (
            await db.execute(select(TripRecord).where(active(TripRecord)))
        ).scalars().all()

        assert [t.trip_name for t in rows] == ["Live"]

    async def test_server_defaults_are_applied(self, db, user):
        trip = await make_trip(db, user)
        await db.refresh(trip)
        assert trip.created_at is not None  # server_default NOW()
        assert trip.is_deleted is False
