from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import TripRecord, app, get_db, make_token, read_trip, write_trip

client = TestClient(app)

# ---------------------------------------------------------------------------
# Fixtures / shared data
# ---------------------------------------------------------------------------

APP_PASSWORD = "honeymoon"
TOKEN_SECRET = "testsecret"

VALID_TOKEN = make_token(APP_PASSWORD, TOKEN_SECRET)

SAMPLE_TRIP = {
    "tripId": "trip_001",
    "tripName": "Test Trip",
    "startDate": "2026-05-10",
    "endDate": "2026-05-20",
    "items": [
        {
            "itemId": "leg_001",
            "parentItemId": None,
            "kind": "leg",
            "title": "Flight to Zurich",
            "startDateTime": "2026-05-10T10:00:00Z",
            "endDateTime": "2026-05-10T18:00:00Z",
            "sortOrder": 1,
            "confirmationNumber": None,
            "type": "travel",
            "subtype": "flight",
            "description": None,
            "locations": [],
            "completed": False,
            "completedDateTime": None,
        }
    ],
}

ENV_VARS = {
    "APP_PASSWORD": APP_PASSWORD,
    "TOKEN_SECRET": TOKEN_SECRET,
    "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/testdb",
}

AUTH_HEADERS = {"Authorization": f"Bearer {VALID_TOKEN}"}


@pytest.fixture
def mock_db():
    db = MagicMock(spec=Session)
    app.dependency_overrides[get_db] = lambda: db
    yield db
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# read_trip / write_trip unit tests
# ---------------------------------------------------------------------------


class TestReadTrip:
    def test_reads_and_returns_trip_data(self):
        db = MagicMock(spec=Session)
        record = MagicMock()
        record.data = SAMPLE_TRIP
        db.query.return_value.order_by.return_value.first.return_value = record

        result = read_trip(db)

        assert result["tripId"] == "trip_001"

    def test_raises_when_no_trip_exists(self):
        db = MagicMock(spec=Session)
        db.query.return_value.order_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="No trip found"):
            read_trip(db)


class TestWriteTrip:
    def test_inserts_new_record_when_trip_not_found(self):
        db = MagicMock(spec=Session)
        db.get.return_value = None

        write_trip(SAMPLE_TRIP, db)

        db.add.assert_called_once()
        added: TripRecord = db.add.call_args[0][0]
        assert added.trip_id == "trip_001"
        assert added.data == SAMPLE_TRIP
        db.commit.assert_called_once()

    def test_updates_existing_record(self):
        db = MagicMock(spec=Session)
        existing = MagicMock(spec=TripRecord)
        db.get.return_value = existing

        write_trip(SAMPLE_TRIP, db)

        assert existing.data == SAMPLE_TRIP
        db.add.assert_not_called()
        db.commit.assert_called_once()


# ---------------------------------------------------------------------------
# GET /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripGet:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("main.read_trip", return_value=SAMPLE_TRIP)
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_returns_trip(self, _mock_read):
        resp = client.get("/trip", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["tripId"] == "trip_001"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.get("/trip")
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.get("/trip", headers={"Authorization": "Bearer invalidtoken"})
        assert resp.status_code == 401

    @patch("main.read_trip", side_effect=Exception("db unavailable"))
    @patch.dict("os.environ", ENV_VARS)
    def test_db_error_returns_500(self, _mock_read):
        resp = client.get("/trip", headers=AUTH_HEADERS)
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# POST /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripPost:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("main.write_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_and_body_returns_200(self, _mock_write):
        resp = client.post("/trip", json=SAMPLE_TRIP, headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.post("/trip", json=SAMPLE_TRIP)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.post(
            "/trip", json=SAMPLE_TRIP, headers={"Authorization": "Bearer badtoken"}
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
    def test_invalid_trip_schema_returns_422(self):
        bad_body = {"foo": "bar"}
        resp = client.post("/trip", json=bad_body, headers=AUTH_HEADERS)
        assert resp.status_code == 422

    @patch("main.write_trip", side_effect=Exception("write failed"))
    @patch.dict("os.environ", ENV_VARS)
    def test_db_error_returns_500(self, _mock_write):
        resp = client.post("/trip", json=SAMPLE_TRIP, headers=AUTH_HEADERS)
        assert resp.status_code == 500
