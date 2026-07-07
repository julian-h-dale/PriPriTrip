"""Tests for the first-class travel/stay detail CRUD endpoints.

Uses a lightweight fake async session (dispatches queries by table) so no real
database is needed.
"""

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.auth import require_auth
from app.database import get_db
from app.main import app
from app.models import StayDetailRecord, TravelDetailRecord, TripRecord


client = TestClient(app)

USER_ID = "11111111-1111-1111-1111-111111111111"
TRIP_ID = "trip-1"


def _fake_user():
    user = MagicMock()
    user.id = USER_ID
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

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, stmt):
        table = None
        try:
            table = stmt.get_final_froms()[0].name
        except Exception:
            table = getattr(getattr(stmt, "table", None), "name", None)
        return _FakeResult(self._rows.get(table, []))

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None

    async def flush(self):
        return None

    def add(self, _obj):
        return None

    async def delete(self, _obj):
        return None


def _install(store, rows_by_table=None):
    session = _FakeSession(store, rows_by_table or {})
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_auth] = _fake_user


def _teardown():
    app.dependency_overrides.clear()


def _trip(owner=USER_ID):
    return TripRecord(trip_id=TRIP_ID, user_id=owner, trip_name="T", start_date="2026-01-01", end_date="2026-01-02")


def _travel(detail_id="td-1", trip_id=TRIP_ID):
    return TravelDetailRecord(
        travel_detail_id=detail_id, trip_id=trip_id, name="Flight BA123",
        mode="flight", operator="BA", vehicle_number="BA123", cabin_class="economy",
        departure_date_time="2026-01-01T10:00:00Z", arrival_date_time="2026-01-01T12:00:00Z",
        confirmation_number="ABC", description=None,
    )


def _stay(detail_id="sd-1", trip_id=TRIP_ID):
    return StayDetailRecord(
        stay_detail_id=detail_id, trip_id=trip_id, name="Hotel Test",
        stay_type="hotel", check_in="2026-01-01T15:00:00Z", check_out="2026-01-02T11:00:00Z",
        room_type="double", confirmation_number="XYZ", description=None,
    )


class TestTravelDetails:
    def teardown_method(self):
        _teardown()

    def test_list(self):
        _install(
            {(TripRecord, TRIP_ID): _trip()},
            {"travel_details": [_travel("td-1"), _travel("td-2")], "locations": []},
        )
        resp = client.get(f"/trips/{TRIP_ID}/travel-details")
        assert resp.status_code == 200
        body = resp.json()
        assert [d["travelDetailId"] for d in body] == ["td-1", "td-2"]
        assert body[0]["name"] == "Flight BA123"
        assert body[0]["mode"] == "flight"

    def test_get_one(self):
        rec = _travel("td-9")
        _install({(TripRecord, TRIP_ID): _trip(), (TravelDetailRecord, "td-9"): rec}, {"locations": []})
        resp = client.get(f"/trips/{TRIP_ID}/travel-details/td-9")
        assert resp.status_code == 200
        assert resp.json()["travelDetailId"] == "td-9"

    def test_get_one_wrong_trip_404(self):
        rec = _travel("td-9", trip_id="other")
        _install({(TripRecord, TRIP_ID): _trip(), (TravelDetailRecord, "td-9"): rec}, {"locations": []})
        resp = client.get(f"/trips/{TRIP_ID}/travel-details/td-9")
        assert resp.status_code == 404

    def test_create(self):
        _install({(TripRecord, TRIP_ID): _trip()}, {"locations": []})
        resp = client.post(
            f"/trips/{TRIP_ID}/travel-details",
            json={"name": "Train to Bern", "mode": "train", "departureDateTime": "2026-01-01T09:00:00Z"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Train to Bern"
        assert body["mode"] == "train"
        assert body["tripId"] == TRIP_ID

    def test_patch(self):
        rec = _travel("td-1")
        _install({(TripRecord, TRIP_ID): _trip(), (TravelDetailRecord, "td-1"): rec}, {"locations": []})
        resp = client.patch(
            f"/trips/{TRIP_ID}/travel-details/td-1",
            json={"cabinClass": "first", "name": "Renamed"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["cabinClass"] == "first"
        assert body["name"] == "Renamed"
        assert body["operator"] == "BA"  # untouched

    def test_delete(self):
        rec = _travel("td-1")
        _install({(TripRecord, TRIP_ID): _trip(), (TravelDetailRecord, "td-1"): rec}, {"locations": []})
        resp = client.delete(f"/trips/{TRIP_ID}/travel-details/td-1")
        assert resp.status_code == 204

    def test_trip_not_owned_404(self):
        _install({(TripRecord, TRIP_ID): _trip(owner="someone-else")}, {"travel_details": [], "locations": []})
        resp = client.get(f"/trips/{TRIP_ID}/travel-details")
        assert resp.status_code == 404


class TestStayDetails:
    def teardown_method(self):
        _teardown()

    def test_list(self):
        _install({(TripRecord, TRIP_ID): _trip()}, {"stay_details": [_stay("sd-1")], "locations": []})
        resp = client.get(f"/trips/{TRIP_ID}/stay-details")
        assert resp.status_code == 200
        body = resp.json()
        assert body[0]["stayDetailId"] == "sd-1"
        assert body[0]["name"] == "Hotel Test"

    def test_create(self):
        _install({(TripRecord, TRIP_ID): _trip()}, {"locations": []})
        resp = client.post(
            f"/trips/{TRIP_ID}/stay-details",
            json={"name": "Grand Hotel", "stayType": "hotel", "checkIn": "2026-01-01T15:00:00Z"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Grand Hotel"
        assert body["stayType"] == "hotel"

    def test_patch(self):
        rec = _stay("sd-1")
        _install({(TripRecord, TRIP_ID): _trip(), (StayDetailRecord, "sd-1"): rec}, {"locations": []})
        resp = client.patch(
            f"/trips/{TRIP_ID}/stay-details/sd-1",
            json={"roomType": "suite", "checkIn": "2026-01-01T16:00:00Z"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["roomType"] == "suite"
        assert body["checkIn"] == "2026-01-01T16:00:00Z"

    def test_delete(self):
        rec = _stay("sd-1")
        _install({(TripRecord, TRIP_ID): _trip(), (StayDetailRecord, "sd-1"): rec}, {"locations": []})
        resp = client.delete(f"/trips/{TRIP_ID}/stay-details/sd-1")
        assert resp.status_code == 204
