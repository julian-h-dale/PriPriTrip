from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import make_token
from app.database import get_db
from app.main import app
from app.models import TripRecord
from app.routers.trip import _get_trip
from app.schemas import TripHeader

client = TestClient(app)

# ---------------------------------------------------------------------------
# Fixtures / shared data
# ---------------------------------------------------------------------------

APP_PASSWORD = "honeymoon"
TOKEN_SECRET = "testsecret"

VALID_TOKEN = make_token(APP_PASSWORD, TOKEN_SECRET)

SAMPLE_TRIP_HEADER = {
    "tripId": "trip_001",
    "tripName": "Test Trip",
    "startDate": "2026-05-10",
    "endDate": "2026-05-20",
}

ENV_VARS = {
    "APP_PASSWORD": APP_PASSWORD,
    "TOKEN_SECRET": TOKEN_SECRET,
    "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/testdb",
}

AUTH_HEADERS = {"Authorization": f"Bearer {VALID_TOKEN}"}


# ---------------------------------------------------------------------------
# _get_trip unit tests
# ---------------------------------------------------------------------------


class TestGetTrip:
    def test_returns_most_recent_trip_record(self):
        db = MagicMock(spec=Session)
        record = MagicMock(spec=TripRecord)
        record.trip_id = "trip_001"
        db.query.return_value.order_by.return_value.first.return_value = record

        result = _get_trip(db)

        assert result.trip_id == "trip_001"

    def test_raises_when_no_trip_exists(self):
        db = MagicMock(spec=Session)
        db.query.return_value.order_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="No trip found"):
            _get_trip(db)


# ---------------------------------------------------------------------------
# POST /trip upsert logic tests (via endpoint + db mock)
# ---------------------------------------------------------------------------


class TestUpsertTrip:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_inserts_new_record_when_trip_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.post("/trip", json=SAMPLE_TRIP_HEADER, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        self.mock_db.add.assert_called_once()
        added: TripRecord = self.mock_db.add.call_args[0][0]
        assert added.trip_id == "trip_001"
        assert added.trip_name == "Test Trip"
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_updates_existing_record(self):
        existing = MagicMock(spec=TripRecord)
        self.mock_db.get.return_value = existing

        resp = client.post("/trip", json=SAMPLE_TRIP_HEADER, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert existing.trip_name == "Test Trip"
        assert existing.start_date == "2026-05-10"
        assert existing.end_date == "2026-05-20"
        self.mock_db.add.assert_not_called()
        self.mock_db.commit.assert_called_once()


# ---------------------------------------------------------------------------
# GET /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripGet:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip._get_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_returns_assembled_trip(self, mock_get_trip):
        record = MagicMock(spec=TripRecord)
        record.trip_id = "trip_001"
        record.trip_name = "Test Trip"
        record.start_date = "2026-05-10"
        record.end_date = "2026-05-20"
        mock_get_trip.return_value = record
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []

        resp = client.get("/trip", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == "trip_001"
        assert body["items"] == []

    @patch("app.routers.trip._get_trip", side_effect=ValueError("No trip found"))
    @patch.dict("os.environ", ENV_VARS)
    def test_missing_trip_returns_404(self, _mock):
        resp = client.get("/trip", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch("app.routers.trip._get_trip", side_effect=Exception("db unavailable"))
    @patch.dict("os.environ", ENV_VARS)
    def test_db_error_returns_500(self, _mock):
        resp = client.get("/trip", headers=AUTH_HEADERS)
        assert resp.status_code == 500

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.get("/trip")
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.get("/trip", headers={"Authorization": "Bearer invalidtoken"})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripPost:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_and_body_returns_200(self):
        self.mock_db.get.return_value = None
        resp = client.post("/trip", json=SAMPLE_TRIP_HEADER, headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.post("/trip", json=SAMPLE_TRIP_HEADER)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.post(
            "/trip", json=SAMPLE_TRIP_HEADER, headers={"Authorization": "Bearer badtoken"}
        )
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_json_returns_422(self):
        resp = client.post(
            "/trip",
            content=b"not-json",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
        )
        assert resp.status_code == 422

    @patch.dict("os.environ", ENV_VARS)
    def test_missing_required_fields_returns_422(self):
        resp = client.post("/trip", json={"foo": "bar"}, headers=AUTH_HEADERS)
        assert resp.status_code == 422

    @patch.dict("os.environ", ENV_VARS)
    def test_db_error_returns_500(self):
        self.mock_db.get.side_effect = Exception("write failed")
        resp = client.post("/trip", json=SAMPLE_TRIP_HEADER, headers=AUTH_HEADERS)
        assert resp.status_code == 500

