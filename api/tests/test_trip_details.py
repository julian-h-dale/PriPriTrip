"""Tests for the standalone travel/stay detail read + patch endpoints.

These use a lightweight fake async session so no real database is needed.
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
    """Minimal async session: get() by (model, pk); execute() returns a list."""

    def __init__(self, store: dict, list_items: list):
        self._store = store
        self._list_items = list_items

    async def get(self, model, pk):
        return self._store.get((model, pk))

    async def execute(self, _stmt):
        return _FakeResult(self._list_items)

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None


def _install(store, list_items):
    session = _FakeSession(store, list_items)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_auth] = _fake_user
    return session


def _teardown():
    app.dependency_overrides.clear()


def _trip(owner=USER_ID):
    return TripRecord(trip_id=TRIP_ID, user_id=owner, trip_name="T", start_date="2026-01-01", end_date="2026-01-02")


def _travel(detail_id="td-1", trip_id=TRIP_ID):
    return TravelDetailRecord(
        travel_detail_id=detail_id, trip_id=trip_id, point_id="p-1",
        mode="train", operator=None, vehicle_number=None, cabin_class=None,
    )


def _stay(detail_id="sd-1", trip_id=TRIP_ID):
    return StayDetailRecord(
        stay_detail_id=detail_id, trip_id=trip_id, point_id="p-2",
        stay_type="hotel", check_in_time=None, check_out_time=None, room_type=None,
    )


class TestTravelDetails:
    def teardown_method(self):
        _teardown()

    def test_list(self):
        store = {(TripRecord, TRIP_ID): _trip()}
        _install(store, [_travel("td-1"), _travel("td-2")])
        resp = client.get(f"/trips/{TRIP_ID}/travel-details")
        assert resp.status_code == 200
        body = resp.json()
        assert [d["travelDetailId"] for d in body] == ["td-1", "td-2"]
        assert body[0]["tripId"] == TRIP_ID
        assert body[0]["pointId"] == "p-1"

    def test_get_one(self):
        rec = _travel("td-9")
        store = {(TripRecord, TRIP_ID): _trip(), (TravelDetailRecord, "td-9"): rec}
        _install(store, [])
        resp = client.get(f"/trips/{TRIP_ID}/travel-details/td-9")
        assert resp.status_code == 200
        assert resp.json()["travelDetailId"] == "td-9"

    def test_get_one_wrong_trip_404(self):
        rec = _travel("td-9", trip_id="other-trip")
        store = {(TripRecord, TRIP_ID): _trip(), (TravelDetailRecord, "td-9"): rec}
        _install(store, [])
        resp = client.get(f"/trips/{TRIP_ID}/travel-details/td-9")
        assert resp.status_code == 404

    def test_patch_updates_only_set_fields(self):
        rec = _travel("td-1")
        rec.operator = "Old"
        store = {(TripRecord, TRIP_ID): _trip(), (TravelDetailRecord, "td-1"): rec}
        _install(store, [])
        resp = client.patch(
            f"/trips/{TRIP_ID}/travel-details/td-1",
            json={"cabinClass": "first"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["cabinClass"] == "first"
        assert body["operator"] == "Old"  # untouched

    def test_trip_not_owned_404(self):
        store = {(TripRecord, TRIP_ID): _trip(owner="someone-else")}
        _install(store, [])
        resp = client.get(f"/trips/{TRIP_ID}/travel-details")
        assert resp.status_code == 404


class TestStayDetails:
    def teardown_method(self):
        _teardown()

    def test_list(self):
        store = {(TripRecord, TRIP_ID): _trip()}
        _install(store, [_stay("sd-1")])
        resp = client.get(f"/trips/{TRIP_ID}/stay-details")
        assert resp.status_code == 200
        assert resp.json()[0]["stayDetailId"] == "sd-1"

    def test_patch(self):
        rec = _stay("sd-1")
        store = {(TripRecord, TRIP_ID): _trip(), (StayDetailRecord, "sd-1"): rec}
        _install(store, [])
        resp = client.patch(
            f"/trips/{TRIP_ID}/stay-details/sd-1",
            json={"roomType": "suite", "checkInTime": "15:00"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["roomType"] == "suite"
        assert body["checkInTime"] == "15:00"
