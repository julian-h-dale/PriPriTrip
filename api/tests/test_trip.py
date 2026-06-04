from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import make_token
from app.database import get_db
from app.main import app
from app.models import TripRecord
from app.schemas import TripHeader

client = TestClient(app)

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


def make_mock_trip(trip_id: str = "trip_001") -> MagicMock:
    record = MagicMock(spec=TripRecord)
    record.trip_id = trip_id
    record.trip_name = "Test Trip"
    record.start_date = "2026-05-10"
    record.end_date = "2026-05-20"
    return record


# ---------------------------------------------------------------------------
# GET /trips  (list)
# ---------------------------------------------------------------------------


class TestApiTripsList:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_list_of_trips(self):
        self.mock_db.query.return_value.order_by.return_value.all.return_value = [
            make_mock_trip()
        ]

        resp = client.get("/trips", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) == 1
        assert body[0]["tripId"] == "trip_001"

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_empty_list_when_no_trips(self):
        self.mock_db.query.return_value.order_by.return_value.all.return_value = []

        resp = client.get("/trips", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert resp.json() == []

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.get("/trips")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /trips/{trip_id}
# ---------------------------------------------------------------------------


class TestApiTripGet:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_returns_assembled_trip(self):
        self.mock_db.get.return_value = make_mock_trip()
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []

        resp = client.get("/trips/trip_001", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == "trip_001"
        assert body["days"] == []

    @patch.dict("os.environ", ENV_VARS)
    def test_missing_trip_returns_404(self):
        self.mock_db.get.return_value = None

        resp = client.get("/trips/trip_001", headers=AUTH_HEADERS)

        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.get("/trips/trip_001")
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.get("/trips/trip_001", headers={"Authorization": "Bearer invalidtoken"})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /trips  (upsert)
# ---------------------------------------------------------------------------


class TestApiTripPost:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_inserts_new_record_when_trip_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.post("/trips", json=SAMPLE_TRIP_HEADER, headers=AUTH_HEADERS)

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

        resp = client.post("/trips", json=SAMPLE_TRIP_HEADER, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert existing.trip_name == "Test Trip"
        assert existing.start_date == "2026-05-10"
        assert existing.end_date == "2026-05-20"
        self.mock_db.add.assert_not_called()
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_and_body_returns_200(self):
        self.mock_db.get.return_value = None
        resp = client.post("/trips", json=SAMPLE_TRIP_HEADER, headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.post("/trips", json=SAMPLE_TRIP_HEADER)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.post(
            "/trips", json=SAMPLE_TRIP_HEADER, headers={"Authorization": "Bearer badtoken"}
        )
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_json_returns_422(self):
        resp = client.post(
            "/trips",
            content=b"not-json",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
        )
        assert resp.status_code == 422
