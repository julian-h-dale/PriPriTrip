import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app, make_token, read_trip, resolve_document_urls, write_trip

client = TestClient(app)

# ---------------------------------------------------------------------------
# Fixtures
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
            "documents": [{"url": "booking.pdf", "name": "Booking"}],
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


# ---------------------------------------------------------------------------
# Helper: build a mock DB context manager
# ---------------------------------------------------------------------------


def _make_db_ctx(mock_conn):
    """Return a MagicMock that acts as the context manager returned by get_db_connection()."""
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=mock_conn)
    cm.__exit__ = MagicMock(return_value=False)
    return cm


# ---------------------------------------------------------------------------
# read_trip / write_trip unit tests
# ---------------------------------------------------------------------------


class TestReadTrip:
    def test_reads_and_parses_trip_from_db(self):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"data": SAMPLE_TRIP}
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        result = read_trip(mock_conn)

        assert result["tripId"] == "trip_001"
        mock_conn.cursor.assert_called_once()

    def test_raises_on_db_error(self):
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value.execute.side_effect = Exception(
            "db error"
        )
        with pytest.raises(Exception, match="db error"):
            read_trip(mock_conn)


class TestWriteTrip:
    def test_upserts_trip_to_db(self):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        write_trip(SAMPLE_TRIP, mock_conn)

        mock_cur.execute.assert_called_once()
        params = mock_cur.execute.call_args[0][1]
        assert params[0] == "trip_001"
        assert "trip_001" in params[1]

    def test_raises_on_db_error(self):
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value.execute.side_effect = Exception(
            "write error"
        )
        with pytest.raises(Exception, match="write error"):
            write_trip(SAMPLE_TRIP, mock_conn)


# ---------------------------------------------------------------------------
# resolve_document_urls unit tests
# ---------------------------------------------------------------------------


class TestResolveDocumentUrls:
    def test_replaces_blob_names_with_api_paths(self):
        result = resolve_document_urls(SAMPLE_TRIP)
        assert result["items"][0]["documents"][0]["url"] == "/documents/booking.pdf"

    def test_does_not_modify_http_urls(self):
        trip = {
            "items": [
                {
                    "documents": [
                        {"url": "https://external.example.com/doc.pdf", "name": "External"}
                    ]
                }
            ],
        }
        result = resolve_document_urls(trip)
        assert result["items"][0]["documents"][0]["url"] == "https://external.example.com/doc.pdf"

    def test_does_not_mutate_original_trip(self):
        _ = resolve_document_urls(SAMPLE_TRIP)
        assert SAMPLE_TRIP["items"][0]["documents"][0]["url"] == "booking.pdf"


# ---------------------------------------------------------------------------
# GET /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripGet:
    @patch("main.read_trip", return_value=SAMPLE_TRIP)
    @patch("main.get_db_connection")
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_returns_trip(self, mock_get_db, _mock_read):
        mock_get_db.return_value = _make_db_ctx(MagicMock())
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
    @patch("main.get_db_connection")
    @patch.dict("os.environ", ENV_VARS)
    def test_db_error_returns_500(self, mock_get_db, _mock_read):
        mock_get_db.return_value = _make_db_ctx(MagicMock())
        resp = client.get("/trip", headers=AUTH_HEADERS)
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# POST /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripPost:
    @patch("main.write_trip")
    @patch("main.get_db_connection")
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_and_body_returns_200(self, mock_get_db, _mock_write):
        mock_get_db.return_value = _make_db_ctx(MagicMock())
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
    def test_invalid_json_returns_400(self):
        resp = client.post(
            "/trip",
            content=b"not-json",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
        )
        assert resp.status_code == 400

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_trip_schema_returns_422(self):
        bad_body = {"foo": "bar"}
        resp = client.post("/trip", json=bad_body, headers=AUTH_HEADERS)
        assert resp.status_code == 422

    @patch("main.write_trip", side_effect=Exception("write failed"))
    @patch("main.get_db_connection")
    @patch.dict("os.environ", ENV_VARS)
    def test_db_error_returns_500(self, mock_get_db, _mock_write):
        mock_get_db.return_value = _make_db_ctx(MagicMock())
        resp = client.post("/trip", json=SAMPLE_TRIP, headers=AUTH_HEADERS)
        assert resp.status_code == 500
