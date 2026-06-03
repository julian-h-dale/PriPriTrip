from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import make_token
from app.database import get_db
from app.main import app
from app.models import TripDayRecord, TripPointRecord, TripRecord
from app.schemas import TripPointResponse
from app.enums import PointType

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

SAMPLE_POINT_PAYLOAD = {
    "pointId": "point_001",
    "dayId": "day_001",
    "type": "travel",
    "title": "Train to Bern",
    "startDateTime": "2026-05-11T12:15:00Z",
    "endDateTime": "2026-05-11T13:30:00Z",
    "sortOrder": 1,
    "confirmationNumber": None,
    "description": None,
    "imageUrl": None,
    "logoUrl": None,
    "locations": [],
    "travelDetail": None,
    "stayDetail": None,
    "completed": False,
    "completedDateTime": None,
}

FULL_UPDATE_PAYLOAD = {
    "dayId": "day_001",
    "type": "travel",
    "title": "Train to Bern (updated)",
    "startDateTime": "2026-05-11T12:15:00Z",
    "endDateTime": "2026-05-11T13:30:00Z",
    "sortOrder": 2,
    "confirmationNumber": "SBB123",
    "description": "Updated",
    "imageUrl": None,
    "logoUrl": None,
    "locations": [],
    "travelDetail": None,
    "stayDetail": None,
    "completed": False,
    "completedDateTime": None,
}


def make_mock_trip(trip_id="trip_001"):
    record = MagicMock(spec=TripRecord)
    record.trip_id = trip_id
    return record


def make_mock_day(day_id="day_001"):
    day = MagicMock(spec=TripDayRecord)
    day.day_id = day_id
    day.deleted_at = None
    return day


def make_mock_point(point_id="point_001", deleted=False):
    point = MagicMock(spec=TripPointRecord)
    point.point_id = point_id
    point.trip_id = "trip_001"
    point.day_id = "day_001"
    point.type = "travel"
    point.title = "Train to Bern"
    point.start_date_time = "2026-05-11T12:15:00Z"
    point.end_date_time = "2026-05-11T13:30:00Z"
    point.sort_order = 1
    point.confirmation_number = None
    point.description = None
    point.image_url = None
    point.logo_url = None
    point.completed = False
    point.completed_date_time = None
    from datetime import datetime, timezone
    point.deleted_at = datetime(2026, 5, 2, tzinfo=timezone.utc) if deleted else None
    point.created_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    point.updated_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    return point


def _db_get_side_effect(mock_point=None, mock_day=None):
    point = mock_point or make_mock_point()
    day = mock_day or make_mock_day()
    def _get(cls, pk):
        if cls is TripPointRecord:
            return point
        if cls is TripDayRecord:
            return day
        return None
    return _get




def make_point_response(point_id="point_001"):
    return TripPointResponse(
        pointId=point_id,
        tripId="trip_001",
        dayId="day_001",
        type=PointType.TRAVEL,
        title="Train to Bern",
        startDateTime="2026-05-11T12:15:00Z",
        endDateTime="2026-05-11T13:30:00Z",
        sortOrder=1,
        completed=False,
    )
class TestApiTripPointsList:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_points._get_trip")
    @patch("app.routers.trip_points._load_point_response")
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_active_points(self, mock_load, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        mock_point = make_mock_point()
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_point]
        mock_load.return_value = make_point_response()
        resp = client.get("/trip/points", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        mock_load.assert_called_once_with(mock_point, self.mock_db)

    @patch("app.routers.trip_points._get_trip", side_effect=ValueError("No trip found"))
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self, _mock):
        resp = client.get("/trip/points", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        assert client.get("/trip/points").status_code == 401


class TestApiTripPointsDeleted:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_points._get_trip")
    @patch("app.routers.trip_points._load_point_response")
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_deleted_points(self, mock_load, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        mock_point = make_mock_point(deleted=True)
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_point]
        mock_load.return_value = make_point_response()
        resp = client.get("/trip/points/deleted", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        mock_load.assert_called_once_with(mock_point, self.mock_db)

    @patch("app.routers.trip_points._get_trip", side_effect=ValueError("No trip found"))
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self, _mock):
        assert client.get("/trip/points/deleted", headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        assert client.get("/trip/points/deleted").status_code == 401


class TestApiTripPointCreate:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_points._get_trip")
    @patch("app.routers.trip_points._load_point_response")
    @patch.dict("os.environ", ENV_VARS)
    def test_creates_point_returns_201(self, mock_load, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        mock_load.return_value = make_point_response()
        def _get(cls, pk):
            if cls is TripPointRecord: return None
            if cls is TripDayRecord: return make_mock_day()
            return None
        self.mock_db.get.side_effect = _get
        resp = client.post("/trip/points", json=SAMPLE_POINT_PAYLOAD, headers=AUTH_HEADERS)
        assert resp.status_code == 201
        self.mock_db.add.assert_called()
        self.mock_db.commit.assert_called_once()

    @patch("app.routers.trip_points._get_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_409_when_point_already_exists(self, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        self.mock_db.get.return_value = make_mock_point()
        assert client.post("/trip/points", json=SAMPLE_POINT_PAYLOAD, headers=AUTH_HEADERS).status_code == 409

    @patch("app.routers.trip_points._get_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_day_not_found(self, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        def _get(cls, pk): return None
        self.mock_db.get.side_effect = _get
        assert client.post("/trip/points", json=SAMPLE_POINT_PAYLOAD, headers=AUTH_HEADERS).status_code == 404

    @patch("app.routers.trip_points._get_trip", side_effect=ValueError("No trip found"))
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self, _mock):
        assert client.post("/trip/points", json=SAMPLE_POINT_PAYLOAD, headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        assert client.post("/trip/points", json=SAMPLE_POINT_PAYLOAD).status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_body_returns_422(self):
        assert client.post("/trip/points", json={"foo": "bar"}, headers=AUTH_HEADERS).status_code == 422


class TestApiTripPointUpdate:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_points._load_point_response")
    @patch.dict("os.environ", ENV_VARS)
    def test_updates_existing_point(self, mock_load):
        point = make_mock_point()
        mock_load.return_value = make_point_response()
        self.mock_db.get.side_effect = _db_get_side_effect(mock_point=point)
        resp = client.put("/trip/points/point_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert point.title == "Train to Bern (updated)"
        assert point.sort_order == 2
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None
        assert client.put("/trip/points/point_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_for_soft_deleted_point(self):
        self.mock_db.get.return_value = make_mock_point(deleted=True)
        assert client.put("/trip/points/point_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        assert client.put("/trip/points/point_001", json=FULL_UPDATE_PAYLOAD).status_code == 401


class TestApiTripPointPatch:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_points._load_point_response")
    @patch.dict("os.environ", ENV_VARS)
    def test_patches_completed_field(self, mock_load):
        point = make_mock_point()
        mock_load.return_value = make_point_response()
        self.mock_db.get.return_value = point
        resp = client.patch("/trip/points/point_001", json={"completed": True}, headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert point.completed is True
        self.mock_db.commit.assert_called_once()

    @patch("app.routers.trip_points._load_point_response")
    @patch.dict("os.environ", ENV_VARS)
    def test_only_supplied_fields_are_changed(self, mock_load):
        point = make_mock_point()
        original_title = point.title
        mock_load.return_value = make_point_response()
        self.mock_db.get.return_value = point
        client.patch("/trip/points/point_001", json={"sortOrder": 99}, headers=AUTH_HEADERS)
        assert point.sort_order == 99
        assert point.title == original_title

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None
        assert client.patch("/trip/points/point_001", json={"completed": True}, headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_for_soft_deleted_point(self):
        self.mock_db.get.return_value = make_mock_point(deleted=True)
        assert client.patch("/trip/points/point_001", json={"completed": True}, headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        assert client.patch("/trip/points/point_001", json={"completed": True}).status_code == 401


class TestApiTripPointDelete:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_soft_deletes_point_returns_204(self):
        point = make_mock_point()
        assert point.deleted_at is None
        self.mock_db.get.return_value = point
        resp = client.delete("/trip/points/point_001", headers=AUTH_HEADERS)
        assert resp.status_code == 204
        assert point.deleted_at is not None
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None
        assert client.delete("/trip/points/point_001", headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_already_deleted(self):
        self.mock_db.get.return_value = make_mock_point(deleted=True)
        assert client.delete("/trip/points/point_001", headers=AUTH_HEADERS).status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        assert client.delete("/trip/points/point_001").status_code == 401


class TestApiTripPointRestore:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_points._load_point_response")
    @patch.dict("os.environ", ENV_VARS)
    def test_restores_deleted_point(self, mock_load):
        point = make_mock_point(deleted=True)
        mock_load.return_value = make_point_response()
        self.mock_db.get.return_value = point
        resp = client.post("/trip/points/point_001/restore", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert point.deleted_at is None
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_409_when_not_deleted(self):
        self.mock_db.get.return_value = make_mock_point(deleted=False)
        assert client.post("/trip/points/point_001/restore", headers=AUTH_HEADERS).status_code == 409

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_409_when_not_found(self):
        self.mock_db.get.return_value = None
        assert client.post("/trip/points/point_001/restore", headers=AUTH_HEADERS).status_code == 409

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        assert client.post("/trip/points/point_001/restore").status_code == 401
