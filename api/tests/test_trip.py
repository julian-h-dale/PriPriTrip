import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app, make_token, read_trip, resolve_document_sas_urls, write_trip

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
    "AZURE_STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "STORAGE_TRIP_CONTAINER": "trip",
    "STORAGE_DOCS_CONTAINER": "documents",
}

AUTH_HEADERS = {"Authorization": f"Bearer {VALID_TOKEN}"}


# ---------------------------------------------------------------------------
# read_trip / write_trip unit tests
# ---------------------------------------------------------------------------


class TestReadTrip:
    @patch.dict("os.environ", {"STORAGE_TRIP_CONTAINER": "trip"})
    def test_reads_and_parses_json_from_blob(self):
        mock_service = MagicMock()
        mock_service.get_blob_client.return_value.download_blob.return_value.readall.return_value = (
            json.dumps(SAMPLE_TRIP).encode()
        )
        result = read_trip(mock_service)
        assert result["tripId"] == "trip_001"
        mock_service.get_blob_client.assert_called_once_with(container="trip", blob="trip.json")

    @patch.dict("os.environ", {"STORAGE_TRIP_CONTAINER": "trip"})
    def test_raises_on_blob_error(self):
        mock_service = MagicMock()
        mock_service.get_blob_client.return_value.download_blob.side_effect = Exception("not found")
        with pytest.raises(Exception, match="not found"):
            read_trip(mock_service)


class TestWriteTrip:
    @patch.dict("os.environ", {"STORAGE_TRIP_CONTAINER": "trip"})
    def test_uploads_json_to_blob(self):
        mock_service = MagicMock()
        write_trip(SAMPLE_TRIP, mock_service)
        mock_service.get_blob_client.assert_called_once_with(container="trip", blob="trip.json")
        call_kwargs = mock_service.get_blob_client.return_value.upload_blob.call_args
        uploaded_data = call_kwargs[0][0]
        parsed = json.loads(uploaded_data)
        assert parsed["tripId"] == "trip_001"
        assert call_kwargs[1].get("overwrite") is True

    @patch.dict("os.environ", {"STORAGE_TRIP_CONTAINER": "trip"})
    def test_raises_on_blob_error(self):
        mock_service = MagicMock()
        mock_service.get_blob_client.return_value.upload_blob.side_effect = Exception("write error")
        with pytest.raises(Exception, match="write error"):
            write_trip(SAMPLE_TRIP, mock_service)


# ---------------------------------------------------------------------------
# resolve_document_sas_urls unit tests
# ---------------------------------------------------------------------------


class TestResolveDocumentSasUrls:
    @patch("main.generate_blob_sas", return_value="sig=token123")
    @patch.dict("os.environ", {"STORAGE_DOCS_CONTAINER": "documents"})
    def test_replaces_blob_names_with_sas_urls(self, mock_gen_sas):
        mock_service = MagicMock()
        mock_service.account_name = "mystorageaccount"
        mock_service.credential.account_key = "dGVzdGtleQ=="

        result = resolve_document_sas_urls(SAMPLE_TRIP, mock_service)

        item_doc_url = result["items"][0]["documents"][0]["url"]
        assert item_doc_url.startswith("https://mystorageaccount.blob.core.windows.net/documents/")
        assert "sig=token123" in item_doc_url

    @patch.dict("os.environ", {"STORAGE_DOCS_CONTAINER": "documents"})
    def test_does_not_modify_http_urls(self, *_):
        mock_service = MagicMock()
        mock_service.account_name = "mystorageaccount"
        mock_service.credential.account_key = "dGVzdGtleQ=="

        trip = {
            "items": [{"documents": [{"url": "https://external.example.com/doc.pdf", "name": "External"}]}],
        }
        result = resolve_document_sas_urls(trip, mock_service)
        assert result["items"][0]["documents"][0]["url"] == "https://external.example.com/doc.pdf"

    @patch.dict("os.environ", {"STORAGE_DOCS_CONTAINER": "documents"})
    def test_does_not_mutate_original_trip(self, *_):
        mock_service = MagicMock()
        mock_service.account_name = "acct"
        mock_service.credential.account_key = "key"

        with patch("main.generate_blob_sas", return_value="sig=x"):
            _ = resolve_document_sas_urls(SAMPLE_TRIP, mock_service)

        # Original should be unchanged
        assert SAMPLE_TRIP["items"][0]["documents"][0]["url"] == "booking.pdf"


# ---------------------------------------------------------------------------
# GET /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripGet:
    @patch("main.get_blob_service_client")
    @patch("main.resolve_document_sas_urls", side_effect=lambda trip, _: trip)
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_returns_trip(self, _mock_sas, mock_client):
        mock_client.return_value.get_blob_client.return_value.download_blob.return_value.readall.return_value = (
            json.dumps(SAMPLE_TRIP).encode()
        )
        resp = client.get("/trip", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == "trip_001"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.get("/trip")
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.get("/trip", headers={"Authorization": "Bearer invalidtoken"})
        assert resp.status_code == 401

    @patch("main.get_blob_service_client")
    @patch.dict("os.environ", ENV_VARS)
    def test_blob_error_returns_500(self, mock_client):
        mock_client.return_value.get_blob_client.return_value.download_blob.side_effect = (
            Exception("blob unavailable")
        )
        resp = client.get("/trip", headers=AUTH_HEADERS)
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# POST /trip endpoint tests
# ---------------------------------------------------------------------------


class TestApiTripPost:
    @patch("main.get_blob_service_client")
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_and_body_returns_200(self, mock_client):
        resp = client.post("/trip", json=SAMPLE_TRIP, headers=AUTH_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        resp = client.post("/trip", json=SAMPLE_TRIP)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        resp = client.post("/trip", json=SAMPLE_TRIP, headers={"Authorization": "Bearer badtoken"})
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

    @patch("main.get_blob_service_client")
    @patch.dict("os.environ", ENV_VARS)
    def test_blob_error_returns_500(self, mock_client):
        mock_client.return_value.get_blob_client.return_value.upload_blob.side_effect = (
            Exception("write failed")
        )
        resp = client.post("/trip", json=SAMPLE_TRIP, headers=AUTH_HEADERS)
        assert resp.status_code == 500
