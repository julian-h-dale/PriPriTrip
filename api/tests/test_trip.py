"""Tests for the /trips CRUD endpoints.

Uses the same lightweight fake async session pattern as test_trip_details.py
(dispatches select() results by table name) so no real database is needed.
"""

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.auth import require_auth
from app.database import get_db
from app.main import app
from app.models import TripRecord

client = TestClient(app)

USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"
TRIP_ID = "trip-1"


def _fake_user(user_id=USER_ID):
    user = MagicMock()
    user.id = user_id
    return user


class _FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return list(self._items)


class _FakeSession:
    """get() by (model, pk); execute() returns rows keyed by target table."""

    def __init__(self, store: dict, rows_by_table: dict):
        self._store = store
        self._rows = rows_by_table
        self.added = []
        self.committed = False

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, stmt):
        try:
            table = stmt.get_final_froms()[0].name
        except Exception:
            table = getattr(getattr(stmt, "table", None), "name", None)
        return _FakeResult(self._rows.get(table, []))

    async def commit(self):
        self.committed = True

    async def refresh(self, _obj):
        return None

    async def flush(self):
        return None

    def add(self, obj):
        self.added.append(obj)


def _install(store, rows_by_table=None, user_id=USER_ID):
    session = _FakeSession(store, rows_by_table or {})
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_auth] = lambda: _fake_user(user_id)
    return session


def _trip(owner=USER_ID, trip_id=TRIP_ID, **overrides):
    rec = TripRecord(
        trip_id=trip_id,
        user_id=owner,
        trip_name="Okinawa",
        status="new",
        start_date="2026-10-30",
        end_date="2026-11-11",
        is_deleted=False,
        deleted_at=None,
    )
    for key, value in overrides.items():
        setattr(rec, key, value)
    return rec


_EMPTY_TRIP_TABLES = {
    "stay_details": [],
    "travel_details": [],
    "trip_days": [],
    "trip_points": [],
    "locations": [],
}


class TestListTrips:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_lists_own_trips(self):
        _install({}, {"trips": [_trip(), _trip(trip_id="trip-2")]})
        resp = client.get("/trips")
        assert resp.status_code == 200
        assert [t["tripId"] for t in resp.json()] == ["trip-1", "trip-2"]

    def test_empty_list(self):
        _install({}, {"trips": []})
        resp = client.get("/trips")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetTrip:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_get_assembled_trip(self):
        _install({(TripRecord, TRIP_ID): _trip()}, dict(_EMPTY_TRIP_TABLES))
        resp = client.get(f"/trips/{TRIP_ID}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == TRIP_ID
        assert body["tripName"] == "Okinawa"
        assert body["days"] == []
        assert body["stays"] == []
        assert body["travels"] == []

    def test_other_users_trip_is_404(self):
        _install({(TripRecord, TRIP_ID): _trip(owner=OTHER_USER_ID)}, dict(_EMPTY_TRIP_TABLES))
        assert client.get(f"/trips/{TRIP_ID}").status_code == 404

    def test_soft_deleted_trip_is_404(self):
        _install(
            {(TripRecord, TRIP_ID): _trip(is_deleted=True)},
            dict(_EMPTY_TRIP_TABLES),
        )
        assert client.get(f"/trips/{TRIP_ID}").status_code == 404

    def test_missing_trip_is_404(self):
        _install({}, dict(_EMPTY_TRIP_TABLES))
        assert client.get("/trips/nope").status_code == 404


class TestUpsertTrip:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def _body(self):
        return {
            "tripName": "Okinawa",
            "startDate": "2026-10-30",
            "endDate": "2026-11-11",
        }

    def test_create(self):
        session = _install({})
        resp = client.put(f"/trips/{TRIP_ID}", json=self._body())
        assert resp.status_code == 200
        assert session.committed
        assert len(session.added) == 1
        assert session.added[0].user_id == USER_ID
        body = resp.json()
        assert body["tripId"] == TRIP_ID
        assert body["tripName"] == "Okinawa"
        assert body["startDate"] == "2026-10-30"
        assert body["endDate"] == "2026-11-11"
        assert body["status"] == "new"

    def test_update_existing(self):
        trip = _trip(trip_name="Old Name")
        _install({(TripRecord, TRIP_ID): trip})
        resp = client.put(f"/trips/{TRIP_ID}", json=self._body())
        assert resp.status_code == 200
        assert trip.trip_name == "Okinawa"
        assert resp.json()["tripName"] == "Okinawa"

    def test_body_trip_id_is_ignored_path_wins(self):
        session = _install({})
        resp = client.put(f"/trips/{TRIP_ID}", json={**self._body(), "tripId": "some-other-id"})
        assert resp.status_code == 200
        assert session.added[0].trip_id == TRIP_ID
        assert resp.json()["tripId"] == TRIP_ID

    def test_update_other_users_trip_forbidden(self):
        _install({(TripRecord, TRIP_ID): _trip(owner=OTHER_USER_ID)})
        assert client.put(f"/trips/{TRIP_ID}", json=self._body()).status_code == 403

    def test_upsert_revives_soft_deleted_trip(self):
        trip = _trip(is_deleted=True)
        _install({(TripRecord, TRIP_ID): trip})
        resp = client.put(f"/trips/{TRIP_ID}", json=self._body())
        assert resp.status_code == 200
        assert trip.is_deleted is False
        assert trip.deleted_at is None


class TestDeleteTrip:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_soft_deletes_trip_and_children(self):
        trip = _trip()
        from app.models import StayDetailRecord, TravelDetailRecord, TripDayRecord, TripPointRecord

        day = TripDayRecord(day_id="d1", trip_id=TRIP_ID, title="Day 1", date="2026-10-30", is_deleted=False)
        point = TripPointRecord(point_id="p1", trip_id=TRIP_ID, day_id="d1", type="activity", title="X", is_deleted=False)
        stay = StayDetailRecord(stay_detail_id="s1", trip_id=TRIP_ID, stay_type="hotel", is_deleted=False)
        travel = TravelDetailRecord(travel_detail_id="t1", trip_id=TRIP_ID, mode="flight", is_deleted=False)
        _install(
            {(TripRecord, TRIP_ID): trip},
            {
                "trip_days": [day],
                "trip_points": [point],
                "stay_details": [stay],
                "travel_details": [travel],
            },
        )
        resp = client.delete(f"/trips/{TRIP_ID}")
        assert resp.status_code == 204
        for rec in (trip, day, point, stay, travel):
            assert rec.is_deleted is True
            assert rec.deleted_at is not None

    def test_other_users_trip_is_404(self):
        _install({(TripRecord, TRIP_ID): _trip(owner=OTHER_USER_ID)})
        assert client.delete(f"/trips/{TRIP_ID}").status_code == 404
