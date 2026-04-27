import json
import os
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch, PropertyMock

import azure.functions as func
import pytest

from function_app import (
    api_trip_get,
    api_trip_put,
    make_token,
    read_trip,
    resolve_document_sas_urls,
    write_trip,
)

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
    "documents": [
        {"url": "flight-confirmation.pdf", "name": "Flight Confirmation"},
    ],
    "items": [
        {
            "itemId": "leg_001",
            "parentItemId": None,
            "kind": "leg",
            "title": "Flight to Zurich",
            "startDateTime": "2026-05-10T10:00:00Z",
            "endDateTime": "2026-05-10T18:00:00Z",
            "sortOrder": 1,
            "collapsedByDefault": False,
            "type": "travel",
            "subtype": "flight",
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


def _bearer_request(method: str, route: str, body: dict = None, token: str = VALID_TOKEN):
    return func.HttpRequest(
        method=method,
        url=f"http://localhost:7071/api/{route}",
        headers={"Authorization": f"Bearer {token}"},
        params={},
        body=json.dumps(body).encode() if body is not None else b"",
    )


def _no_auth_request(method: str, route: str, body: dict = None):
    return func.HttpRequest(
        method=method,
        url=f"http://localhost:7071/api/{route}",
        headers={},
        params={},
        body=json.dumps(body).encode() if body is not None else b"",
    )


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
    @patch("function_app.generate_blob_sas", return_value="sig=token123")
    @patch.dict("os.environ", {"STORAGE_DOCS_CONTAINER": "documents"})
    def test_replaces_blob_names_with_sas_urls(self, mock_gen_sas):
        mock_service = MagicMock()
        mock_service.account_name = "mystorageaccount"
        mock_service.credential.account_key = "dGVzdGtleQ=="

        result = resolve_document_sas_urls(SAMPLE_TRIP, mock_service)

        trip_doc_url = result["documents"][0]["url"]
        assert trip_doc_url.startswith("https://mystorageaccount.blob.core.windows.net/documents/")
        assert "sig=token123" in trip_doc_url

        item_doc_url = result["items"][0]["documents"][0]["url"]
        assert item_doc_url.startswith("https://mystorageaccount.blob.core.windows.net/documents/")

    @patch.dict("os.environ", {"STORAGE_DOCS_CONTAINER": "documents"})
    def test_does_not_modify_http_urls(self, *_):
        mock_service = MagicMock()
        mock_service.account_name = "mystorageaccount"
        mock_service.credential.account_key = "dGVzdGtleQ=="

        trip = {
            "documents": [{"url": "https://external.example.com/doc.pdf", "name": "External"}],
            "items": [],
        }
        result = resolve_document_sas_urls(trip, mock_service)
        assert result["documents"][0]["url"] == "https://external.example.com/doc.pdf"

    @patch.dict("os.environ", {"STORAGE_DOCS_CONTAINER": "documents"})
    def test_does_not_mutate_original_trip(self, *_):
        mock_service = MagicMock()
        mock_service.account_name = "acct"
        mock_service.credential.account_key = "key"

        with patch("function_app.generate_blob_sas", return_value="sig=x"):
            _ = resolve_document_sas_urls(SAMPLE_TRIP, mock_service)

        # Original should be unchanged
        assert SAMPLE_TRIP["documents"][0]["url"] == "flight-confirmation.pdf"


# ---------------------------------------------------------------------------
# api_trip_get handler tests
# ---------------------------------------------------------------------------


class TestApiTripGet:
    @patch("function_app.get_blob_service_client")
    @patch("function_app.resolve_document_sas_urls", side_effect=lambda trip, _: trip)
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_returns_trip(self, _mock_sas, mock_client):
        mock_client.return_value.get_blob_client.return_value.download_blob.return_value.readall.return_value = (
            json.dumps(SAMPLE_TRIP).encode()
        )
        req = _bearer_request("GET", "trip")
        resp = api_trip_get(req)
        assert resp.status_code == 200
        body = json.loads(resp.get_body())
        assert body["tripId"] == "trip_001"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        req = _no_auth_request("GET", "trip")
        resp = api_trip_get(req)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        req = _bearer_request("GET", "trip", token="invalidtoken")
        resp = api_trip_get(req)
        assert resp.status_code == 401

    @patch("function_app.get_blob_service_client")
    @patch.dict("os.environ", ENV_VARS)
    def test_blob_error_returns_500(self, mock_client):
        mock_client.return_value.get_blob_client.return_value.download_blob.side_effect = (
            Exception("blob unavailable")
        )
        req = _bearer_request("GET", "trip")
        resp = api_trip_get(req)
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# api_trip_put handler tests
# ---------------------------------------------------------------------------


class TestApiTripPut:
    @patch("function_app.get_blob_service_client")
    @patch.dict("os.environ", ENV_VARS)
    def test_valid_token_and_body_returns_200(self, mock_client):
        req = _bearer_request("PUT", "trip", body=SAMPLE_TRIP)
        resp = api_trip_put(req)
        assert resp.status_code == 200
        body = json.loads(resp.get_body())
        assert body["status"] == "ok"

    @patch.dict("os.environ", ENV_VARS)
    def test_no_token_returns_401(self):
        req = _no_auth_request("PUT", "trip", body=SAMPLE_TRIP)
        resp = api_trip_put(req)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_token_returns_401(self):
        req = _bearer_request("PUT", "trip", body=SAMPLE_TRIP, token="badtoken")
        resp = api_trip_put(req)
        assert resp.status_code == 401

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_json_returns_400(self):
        req = func.HttpRequest(
            method="PUT",
            url="http://localhost:7071/api/trip",
            headers={"Authorization": f"Bearer {VALID_TOKEN}"},
            params={},
            body=b"not-json",
        )
        resp = api_trip_put(req)
        assert resp.status_code == 400

    @patch.dict("os.environ", ENV_VARS)
    def test_invalid_trip_schema_returns_422(self):
        # Missing required fields (tripId, tripName, etc.)
        bad_body = {"foo": "bar"}
        req = _bearer_request("PUT", "trip", body=bad_body)
        resp = api_trip_put(req)
        assert resp.status_code == 422

    @patch("function_app.get_blob_service_client")
    @patch.dict("os.environ", ENV_VARS)
    def test_blob_error_returns_500(self, mock_client):
        mock_client.return_value.get_blob_client.return_value.upload_blob.side_effect = (
            Exception("write failed")
        )
        req = _bearer_request("PUT", "trip", body=SAMPLE_TRIP)
        resp = api_trip_put(req)
        assert resp.status_code == 500
