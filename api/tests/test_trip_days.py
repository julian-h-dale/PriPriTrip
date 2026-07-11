"""Tests for the /trips/{trip_id}/days CRUD + restore endpoints.

Same fake-session pattern as test_trip.py / test_trip_details.py.
"""

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.auth import require_auth
from app.database import get_db
from app.main import app
from app.models import TripDayRecord, TripRecord

client = TestClient(app)

USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"
TRIP_ID = "trip-1"
DAY_ID = "day-1"


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
    def __init__(self, store: dict, rows_by_table: dict):
        self._store = store
        self._rows = rows_by_table
        self.added = []

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, stmt):
        try:
            table = stmt.get_final_froms()[0].name
        except Exception:
            table = getattr(getattr(stmt, "table", None), "name", None)
        return _FakeResult(self._rows.get(table, []))

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None

    def add(self, obj):
        self.added.append(obj)


def _install(store, rows_by_table=None, user_id=USER_ID):
    session = _FakeSession(store, rows_by_table or {})
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_auth] = lambda: _fake_user(user_id)
    return session


def _trip(owner=USER_ID):
    return TripRecord(
        trip_id=TRIP_ID,
        user_id=owner,
        trip_name="T",
        start_date="2026-10-30",
        end_date="2026-11-11",
        is_deleted=False,
        deleted_at=None,
    )


def _day(day_id=DAY_ID, trip_id=TRIP_ID, **overrides):
    rec = TripDayRecord(
        day_id=day_id,
        trip_id=trip_id,
        title="Day 1",
        date="2026-10-30",
        description=None,
        is_alternate=False,
        completed=False,
        is_deleted=False,
        deleted_at=None,
    )
    for key, value in overrides.items():
        setattr(rec, key, value)
    return rec


class TestListDays:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_list(self):
        _install(
            {(TripRecord, TRIP_ID): _trip()},
            {"trip_days": [_day("day-1"), _day("day-2")]},
        )
        resp = client.get(f"/trips/{TRIP_ID}/days")
        assert resp.status_code == 200
        assert [d["dayId"] for d in resp.json()] == ["day-1", "day-2"]

    def test_other_users_trip_is_404(self):
        _install({(TripRecord, TRIP_ID): _trip(owner=OTHER_USER_ID)})
        assert client.get(f"/trips/{TRIP_ID}/days").status_code == 404


class TestCreateDay:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def _body(self):
        return {"dayId": DAY_ID, "title": "Day 1", "date": "2026-10-30"}

    def test_create(self):
        session = _install({(TripRecord, TRIP_ID): _trip()})
        resp = client.post(f"/trips/{TRIP_ID}/days", json=self._body())
        assert resp.status_code == 201
        assert resp.json()["dayId"] == DAY_ID
        assert len(session.added) == 1

    def test_duplicate_conflict(self):
        _install(
            {
                (TripRecord, TRIP_ID): _trip(),
                (TripDayRecord, DAY_ID): _day(),
            }
        )
        assert client.post(f"/trips/{TRIP_ID}/days", json=self._body()).status_code == 409

    def test_missing_required_fields(self):
        _install({(TripRecord, TRIP_ID): _trip()})
        assert client.post(f"/trips/{TRIP_ID}/days", json={"dayId": DAY_ID}).status_code == 422


class TestUpdateDay:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_patch_full_update(self):
        day = _day()
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        resp = client.patch(
            f"/trips/{TRIP_ID}/days/{DAY_ID}",
            json={
                "title": "New Title",
                "date": "2026-10-31",
                "description": "desc",
                "isAlternate": True,
                "completed": True,
            },
        )
        assert resp.status_code == 200
        assert day.title == "New Title"
        assert day.date == "2026-10-31"
        assert day.is_alternate is True

    def test_put_day_is_gone(self):
        day = _day()
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        resp = client.put(
            f"/trips/{TRIP_ID}/days/{DAY_ID}",
            json={"title": "x", "date": "2026-10-31"},
        )
        assert resp.status_code == 405

    def test_patch_partial_update(self):
        day = _day()
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        resp = client.patch(f"/trips/{TRIP_ID}/days/{DAY_ID}", json={"title": "Patched"})
        assert resp.status_code == 200
        assert day.title == "Patched"
        # Untouched fields keep their values.
        assert day.date == "2026-10-30"
        assert day.completed is False

    def test_day_from_other_trip_is_404(self):
        day = _day(trip_id="other-trip")
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        assert (
            client.patch(f"/trips/{TRIP_ID}/days/{DAY_ID}", json={"title": "x"}).status_code == 404
        )

    def test_other_users_trip_is_404(self):
        _install(
            {
                (TripRecord, TRIP_ID): _trip(owner=OTHER_USER_ID),
                (TripDayRecord, DAY_ID): _day(),
            }
        )
        assert (
            client.patch(f"/trips/{TRIP_ID}/days/{DAY_ID}", json={"title": "x"}).status_code == 404
        )


class TestDeleteRestoreDay:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_soft_delete(self):
        day = _day()
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        resp = client.delete(f"/trips/{TRIP_ID}/days/{DAY_ID}")
        assert resp.status_code == 204
        assert day.is_deleted is True
        assert day.deleted_at is not None

    def test_delete_already_deleted_is_404(self):
        from datetime import datetime, timezone

        day = _day(is_deleted=True, deleted_at=datetime.now(timezone.utc))
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        assert client.delete(f"/trips/{TRIP_ID}/days/{DAY_ID}").status_code == 404

    def test_restore(self):
        from datetime import datetime, timezone

        day = _day(is_deleted=True, deleted_at=datetime.now(timezone.utc))
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        resp = client.post(f"/trips/{TRIP_ID}/days/{DAY_ID}/restore")
        assert resp.status_code == 200
        assert day.is_deleted is False
        assert day.deleted_at is None

    def test_restore_not_deleted_conflict(self):
        day = _day()
        _install({(TripRecord, TRIP_ID): _trip(), (TripDayRecord, DAY_ID): day})
        assert client.post(f"/trips/{TRIP_ID}/days/{DAY_ID}/restore").status_code == 409

    def test_list_deleted(self):
        from datetime import datetime, timezone

        deleted = _day(is_deleted=True, deleted_at=datetime.now(timezone.utc))
        _install(
            {(TripRecord, TRIP_ID): _trip()},
            {"trip_days": [deleted]},
        )
        resp = client.get(f"/trips/{TRIP_ID}/days/deleted")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
