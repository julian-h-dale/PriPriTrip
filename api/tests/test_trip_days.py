from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import make_token
from app.database import get_db
from app.main import app
from app.models import TripDayRecord, TripRecord

client = TestClient(app)

APP_PASSWORD = "honeymoon"
TOKEN_SECRET = "testsecret"
VALID_TOKEN = make_token(APP_PASSWORD, TOKEN_SECRET)
AUTH_HEADERS = {"Authorization": f"Bearer {VALID_TOKEN}"}

ENV_VARS = {
    "APP_PASSWORD": APP_PASSWORD,
    "TOKEN_SECRET": TOKEN_SECRET,
    "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/testdb",
}

TRIP_ID = "trip_001"
BASE = f"/trips/{TRIP_ID}/days"

SAMPLE_DAY_PAYLOAD = {
    "dayId": "day_001",
    "title": "May 11 - Arrival in Bern",
    "date": "2026-05-11",
    "description": "Arrive and settle in.",
    "completed": False,
}

FULL_UPDATE_PAYLOAD = {
    "title": "May 11 - Updated",
    "date": "2026-05-11",
    "description": "Updated description.",
    "completed": True,
}


def make_mock_trip(trip_id: str = TRIP_ID) -> MagicMock:
    record = MagicMock(spec=TripRecord)
    record.trip_id = trip_id
    return record


def make_mock_day(day_id: str = "day_001", deleted: bool = False) -> MagicMock:
    day = MagicMock(spec=TripDayRecord)
    day.day_id = day_id
    day.trip_id = TRIP_ID
    day.title = "May 11 - Arrival in Bern"
    day.date = "2026-05-11"
    day.description = "Arrive and settle in."
    day.is_alternate = False
    day.completed = False
    day.deleted_at = datetime(2026, 5, 2, tzinfo=timezone.utc) if deleted else None
    day.created_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    day.updated_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    return day


# ---------------------------------------------------------------------------
# GET /trips/{trip_id}/days
# ---------------------------------------------------------------------------


class TestApiTripDaysList:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_active_days(self):
        self.mock_db.get.return_value = make_mock_trip()
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            make_mock_day()
        ]

        resp = client.get(BASE, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["dayId"] == "day_001"
        assert data[0]["deletedAt"] is None

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self):
        self.mock_db.get.return_value = None

        resp = client.get(BASE, headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.get(BASE)
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /trips/{trip_id}/days/deleted
# ---------------------------------------------------------------------------


class TestApiTripDaysDeleted:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_only_deleted_days(self):
        self.mock_db.get.return_value = make_mock_trip()
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            make_mock_day(deleted=True)
        ]

        resp = client.get(f"{BASE}/deleted", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["deletedAt"] is not None

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self):
        self.mock_db.get.return_value = None

        resp = client.get(f"{BASE}/deleted", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.get(f"{BASE}/deleted")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /trips/{trip_id}/days
# ---------------------------------------------------------------------------


class TestApiTripDayCreate:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_creates_day_returns_201(self):
        def get_side_effect(model, key):
            if model is TripRecord:
                return make_mock_trip()
            return None  # day does not exist yet

        self.mock_db.get.side_effect = get_side_effect

        resp = client.post(BASE, json=SAMPLE_DAY_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 201
        self.mock_db.add.assert_called_once()
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_409_when_day_already_exists(self):
        def get_side_effect(model, key):
            if model is TripRecord:
                return make_mock_trip()
            return make_mock_day()

        self.mock_db.get.side_effect = get_side_effect

        resp = client.post(BASE, json=SAMPLE_DAY_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 409

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self):
        self.mock_db.get.return_value = None

        resp = client.post(BASE, json=SAMPLE_DAY_PAYLOAD, headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.post(BASE, json=SAMPLE_DAY_PAYLOAD)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_body_returns_422(self):
        resp = client.post(BASE, json={"foo": "bar"}, headers=AUTH_HEADERS)
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PUT /trips/{trip_id}/days/{day_id}
# ---------------------------------------------------------------------------


class TestApiTripDayUpdate:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_updates_existing_day(self):
        day = make_mock_day()
        self.mock_db.get.return_value = day

        resp = client.put(f"{BASE}/day_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert day.title == "May 11 - Updated"
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.put(f"{BASE}/day_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_for_soft_deleted_day(self):
        self.mock_db.get.return_value = make_mock_day(deleted=True)

        resp = client.put(f"{BASE}/day_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.put(f"{BASE}/day_001", json=FULL_UPDATE_PAYLOAD)
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /trips/{trip_id}/days/{day_id}
# ---------------------------------------------------------------------------


class TestApiTripDayPatch:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_patches_completed_field(self):
        day = make_mock_day()
        self.mock_db.get.return_value = day

        resp = client.patch(f"{BASE}/day_001", json={"completed": True}, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert day.completed is True
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_only_supplied_fields_are_changed(self):
        day = make_mock_day()
        original_title = day.title
        self.mock_db.get.return_value = day

        client.patch(f"{BASE}/day_001", json={"completed": True}, headers=AUTH_HEADERS)

        assert day.completed is True
        assert day.title == original_title

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.patch(f"{BASE}/day_001", json={"completed": True}, headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_for_soft_deleted_day(self):
        self.mock_db.get.return_value = make_mock_day(deleted=True)

        resp = client.patch(f"{BASE}/day_001", json={"completed": True}, headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.patch(f"{BASE}/day_001", json={"completed": True})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# DELETE /trips/{trip_id}/days/{day_id}
# ---------------------------------------------------------------------------


class TestApiTripDayDelete:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_soft_deletes_day_returns_204(self):
        day = make_mock_day()
        assert day.deleted_at is None
        self.mock_db.get.return_value = day

        resp = client.delete(f"{BASE}/day_001", headers=AUTH_HEADERS)

        assert resp.status_code == 204
        assert day.deleted_at is not None
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.delete(f"{BASE}/day_001", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_already_deleted(self):
        self.mock_db.get.return_value = make_mock_day(deleted=True)

        resp = client.delete(f"{BASE}/day_001", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.delete(f"{BASE}/day_001")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /trips/{trip_id}/days/{day_id}/restore
# ---------------------------------------------------------------------------


class TestApiTripDayRestore:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_restores_deleted_day(self):
        day = make_mock_day(deleted=True)
        self.mock_db.get.return_value = day

        resp = client.post(f"{BASE}/day_001/restore", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert day.deleted_at is None
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_409_when_not_deleted(self):
        self.mock_db.get.return_value = make_mock_day(deleted=False)

        resp = client.post(f"{BASE}/day_001/restore", headers=AUTH_HEADERS)
        assert resp.status_code == 409

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.post(f"{BASE}/day_001/restore", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.post(f"{BASE}/day_001/restore")
        assert resp.status_code == 401
