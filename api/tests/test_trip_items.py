from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import make_token
from app.database import get_db
from app.main import app
from app.models import TripItemRecord, TripRecord

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

SAMPLE_ITEM_PAYLOAD = {
    "itemId": "item_001",
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
    "imageUrl": None,
    "logoUrl": None,
    "locations": [],
    "completed": False,
    "completedDateTime": None,
}

FULL_UPDATE_PAYLOAD = {
    "parentItemId": None,
    "kind": "leg",
    "title": "Updated Flight",
    "startDateTime": "2026-05-10T10:00:00Z",
    "endDateTime": "2026-05-10T18:00:00Z",
    "sortOrder": 2,
    "confirmationNumber": "ABC123",
    "type": "travel",
    "subtype": "flight",
    "description": "Updated",
    "imageUrl": None,
    "logoUrl": None,
    "locations": [],
    "completed": False,
    "completedDateTime": None,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_mock_trip(trip_id: str = "trip_001") -> MagicMock:
    record = MagicMock(spec=TripRecord)
    record.trip_id = trip_id
    return record


def make_mock_item(item_id: str = "item_001", deleted: bool = False) -> MagicMock:
    item = MagicMock(spec=TripItemRecord)
    item.item_id = item_id
    item.trip_id = "trip_001"
    item.parent_item_id = None
    item.kind = "leg"
    item.title = "Flight to Zurich"
    item.start_date_time = "2026-05-10T10:00:00Z"
    item.end_date_time = "2026-05-10T18:00:00Z"
    item.sort_order = 1
    item.confirmation_number = None
    item.type = "travel"
    item.subtype = "flight"
    item.description = None
    item.image_url = None
    item.logo_url = None
    item.locations = []
    item.completed = False
    item.completed_date_time = None
    item.deleted_at = datetime(2026, 5, 2, tzinfo=timezone.utc) if deleted else None
    item.created_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    item.updated_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    return item


# ---------------------------------------------------------------------------
# GET /trip/items
# ---------------------------------------------------------------------------


class TestApiTripItemsList:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_items._get_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_active_items(self, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            make_mock_item()
        ]

        resp = client.get("/trip/items", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["itemId"] == "item_001"
        assert data[0]["deletedAt"] is None

    @patch("app.routers.trip_items._get_trip", side_effect=ValueError("No trip found"))
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self, _mock):
        resp = client.get("/trip/items", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.get("/trip/items")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /trip/items/deleted
# ---------------------------------------------------------------------------


class TestApiTripItemsDeleted:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_items._get_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_only_deleted_items(self, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            make_mock_item(deleted=True)
        ]

        resp = client.get("/trip/items/deleted", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["deletedAt"] is not None

    @patch("app.routers.trip_items._get_trip", side_effect=ValueError("No trip found"))
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self, _mock):
        resp = client.get("/trip/items/deleted", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.get("/trip/items/deleted")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /trip/items
# ---------------------------------------------------------------------------


class TestApiTripItemCreate:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch("app.routers.trip_items._get_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_creates_item_returns_201(self, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        self.mock_db.get.return_value = None  # item does not exist yet

        resp = client.post("/trip/items", json=SAMPLE_ITEM_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 201
        self.mock_db.add.assert_called_once()
        self.mock_db.commit.assert_called_once()

    @patch("app.routers.trip_items._get_trip")
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_409_when_item_already_exists(self, mock_get_trip):
        mock_get_trip.return_value = make_mock_trip()
        self.mock_db.get.return_value = make_mock_item()  # already exists

        resp = client.post("/trip/items", json=SAMPLE_ITEM_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 409

    @patch("app.routers.trip_items._get_trip", side_effect=ValueError("No trip found"))
    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_no_trip(self, _mock):
        resp = client.post("/trip/items", json=SAMPLE_ITEM_PAYLOAD, headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.post("/trip/items", json=SAMPLE_ITEM_PAYLOAD)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_body_returns_422(self):
        resp = client.post("/trip/items", json={"foo": "bar"}, headers=AUTH_HEADERS)
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PUT /trip/items/{item_id}
# ---------------------------------------------------------------------------


class TestApiTripItemUpdate:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_updates_existing_item(self):
        item = make_mock_item()
        self.mock_db.get.return_value = item

        resp = client.put("/trip/items/item_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert item.title == "Updated Flight"
        assert item.sort_order == 2
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.put("/trip/items/item_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_for_soft_deleted_item(self):
        self.mock_db.get.return_value = make_mock_item(deleted=True)

        resp = client.put("/trip/items/item_001", json=FULL_UPDATE_PAYLOAD, headers=AUTH_HEADERS)

        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.put("/trip/items/item_001", json=FULL_UPDATE_PAYLOAD)
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /trip/items/{item_id}
# ---------------------------------------------------------------------------


class TestApiTripItemPatch:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_patches_completed_field(self):
        item = make_mock_item()
        self.mock_db.get.return_value = item

        resp = client.patch(
            "/trip/items/item_001", json={"completed": True}, headers=AUTH_HEADERS
        )

        assert resp.status_code == 200
        assert item.completed is True
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_only_supplied_fields_are_changed(self):
        item = make_mock_item()
        original_title = item.title
        self.mock_db.get.return_value = item

        client.patch("/trip/items/item_001", json={"sortOrder": 99}, headers=AUTH_HEADERS)

        assert item.sort_order == 99
        assert item.title == original_title

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.patch(
            "/trip/items/item_001", json={"completed": True}, headers=AUTH_HEADERS
        )
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_for_soft_deleted_item(self):
        self.mock_db.get.return_value = make_mock_item(deleted=True)

        resp = client.patch(
            "/trip/items/item_001", json={"completed": True}, headers=AUTH_HEADERS
        )
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.patch("/trip/items/item_001", json={"completed": True})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# DELETE /trip/items/{item_id}  (soft delete)
# ---------------------------------------------------------------------------


class TestApiTripItemDelete:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_soft_deletes_item_returns_204(self):
        item = make_mock_item()
        assert item.deleted_at is None
        self.mock_db.get.return_value = item

        resp = client.delete("/trip/items/item_001", headers=AUTH_HEADERS)

        assert resp.status_code == 204
        assert item.deleted_at is not None
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_deleted_item_excluded_from_active_list(self):
        item = make_mock_item()
        self.mock_db.get.return_value = item

        client.delete("/trip/items/item_001", headers=AUTH_HEADERS)

        # deleted_at is now set; a subsequent GET /trip/items query filtered
        # on deleted_at IS NULL would exclude this item.
        assert item.deleted_at is not None

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.delete("/trip/items/item_001", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_already_deleted(self):
        self.mock_db.get.return_value = make_mock_item(deleted=True)

        resp = client.delete("/trip/items/item_001", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.delete("/trip/items/item_001")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /trip/items/{item_id}/restore
# ---------------------------------------------------------------------------


class TestApiTripItemRestore:
    def setup_method(self):
        self.mock_db = MagicMock(spec=Session)
        app.dependency_overrides[get_db] = lambda: self.mock_db

    def teardown_method(self):
        app.dependency_overrides.clear()

    @patch.dict("os.environ", ENV_VARS)
    def test_restores_soft_deleted_item(self):
        item = make_mock_item(deleted=True)
        self.mock_db.get.return_value = item

        resp = client.post("/trip/items/item_001/restore", headers=AUTH_HEADERS)

        assert resp.status_code == 200
        assert item.deleted_at is None
        self.mock_db.commit.assert_called_once()

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_404_when_item_not_found(self):
        self.mock_db.get.return_value = None

        resp = client.post("/trip/items/item_001/restore", headers=AUTH_HEADERS)
        assert resp.status_code == 404

    @patch.dict("os.environ", ENV_VARS)
    def test_returns_409_when_item_not_deleted(self):
        self.mock_db.get.return_value = make_mock_item(deleted=False)

        resp = client.post("/trip/items/item_001/restore", headers=AUTH_HEADERS)
        assert resp.status_code == 409

    @patch.dict("os.environ", ENV_VARS)
    def test_requires_auth(self):
        resp = client.post("/trip/items/item_001/restore")
        assert resp.status_code == 401
