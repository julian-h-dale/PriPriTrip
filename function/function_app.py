import copy
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    generate_blob_sas,
)
from pydantic import BaseModel, ValidationError

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


# ---------------------------------------------------------------------------
# Pydantic models — light validation only
# ---------------------------------------------------------------------------


class DocumentModel(BaseModel):
    url: str
    name: str
    description: Optional[str] = None


class TripItemModel(BaseModel):
    itemId: str
    parentItemId: Optional[str] = None
    kind: Literal["group", "leg"]
    title: str
    startDateTime: str
    endDateTime: str
    sortOrder: int
    confirmationNumber: Optional[str] = None
    type: Optional[Literal["travel", "stay", "activity"]] = None
    subtype: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: List[dict] = []
    documents: List[dict] = []
    completed: bool = False
    completedDateTime: Optional[str] = None


class TripDocument(BaseModel):
    tripId: str
    tripName: str
    startDate: str
    endDate: str
    items: List[TripItemModel] = []


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def make_token(password: str, secret: str) -> str:
    return hmac.new(secret.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_token(token: str, app_password: str, secret: str) -> bool:
    expected = make_token(app_password, secret)
    return hmac.compare_digest(expected, token)


def get_bearer_token(req: func.HttpRequest) -> Optional[str]:
    auth = req.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def json_response(data: dict, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(data, ensure_ascii=False),
        status_code=status_code,
        mimetype="application/json",
    )


# ---------------------------------------------------------------------------
# Blob helpers
# ---------------------------------------------------------------------------


def get_blob_service_client() -> BlobServiceClient:
    """Return a BlobServiceClient using connection string (local dev / explicit)
    or DefaultAzureCredential (managed identity in production)."""
    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    if conn_str:
        return BlobServiceClient.from_connection_string(conn_str)
    account = os.environ.get("STORAGE_ACCOUNT", "")
    account_url = f"https://{account}.blob.core.windows.net"
    return BlobServiceClient(account_url=account_url, credential=DefaultAzureCredential())


def read_trip(blob_service: BlobServiceClient) -> dict:
    container = os.environ.get("STORAGE_TRIP_CONTAINER", "trip")
    blob = blob_service.get_blob_client(container=container, blob="trip.json")
    data = blob.download_blob().readall()
    return json.loads(data)


def write_trip(trip: dict, blob_service: BlobServiceClient) -> None:
    container = os.environ.get("STORAGE_TRIP_CONTAINER", "trip")
    blob = blob_service.get_blob_client(container=container, blob="trip.json")
    blob.upload_blob(json.dumps(trip, ensure_ascii=False), overwrite=True)


def resolve_document_sas_urls(trip: dict, blob_service: BlobServiceClient) -> dict:
    """Replace blob-name document URL fields with short-lived SAS URLs.

    Stored document `url` values are blob names within the documents container
    (not pre-signed URLs).  URLs that already begin with 'http' are left as-is.
    Uses account-key SAS when available; falls back to user delegation SAS
    (requires Storage Blob Delegator role on the managed identity).
    """
    docs_container = os.environ.get("STORAGE_DOCS_CONTAINER", "documents")
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)

    # Prefer account key (connection string / dev); fall back to delegation key.
    account_key: Optional[str] = None
    try:
        cred = blob_service.credential
        if hasattr(cred, "account_key"):
            account_key = cred.account_key
    except Exception:
        pass

    user_delegation_key = None
    if not account_key:
        try:
            user_delegation_key = blob_service.get_user_delegation_key(
                key_start_time=datetime.now(timezone.utc),
                key_expiry_time=expiry,
            )
        except Exception as exc:
            logging.warning("Could not obtain user delegation key for SAS: %s", exc)
            return trip

    def make_sas_url(blob_name: str) -> str:
        if not blob_name or blob_name.startswith("http"):
            return blob_name
        kwargs = dict(
            account_name=blob_service.account_name,
            container_name=docs_container,
            blob_name=blob_name,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
        )
        if account_key:
            kwargs["account_key"] = account_key
        else:
            kwargs["user_delegation_key"] = user_delegation_key
        token = generate_blob_sas(**kwargs)
        return (
            f"https://{blob_service.account_name}.blob.core.windows.net"
            f"/{docs_container}/{blob_name}?{token}"
        )

    trip = copy.deepcopy(trip)
    for item in trip.get("items", []):
        for doc in item.get("documents", []):
            doc["url"] = make_sas_url(doc.get("url", ""))
    return trip


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@app.route(route="auth", methods=["POST"])
def api_auth(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return json_response({"error": "Invalid JSON"}, 400)

    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    password = body.get("password", "")

    if not hmac.compare_digest(password, app_password):
        return json_response({"error": "Invalid password"}, 401)

    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")
    token = make_token(password, token_secret)
    maps_api_key = os.environ.get("MAPS_API_KEY", "")

    return json_response({"token": token, "mapsApiKey": maps_api_key})


@app.route(route="trip", methods=["GET"])
def api_trip_get(req: func.HttpRequest) -> func.HttpResponse:
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")

    token = get_bearer_token(req)
    if not token or not verify_token(token, app_password, token_secret):
        return json_response({"error": "Unauthorized"}, 401)

    try:
        blob_service = get_blob_service_client()
        trip = read_trip(blob_service)
        trip = resolve_document_sas_urls(trip, blob_service)
        return json_response(trip)
    except Exception as exc:
        logging.error("GET /api/trip error: %s", exc)
        return json_response({"error": "Failed to read trip"}, 500)


@app.route(route="trip", methods=["PUT"])
def api_trip_put(req: func.HttpRequest) -> func.HttpResponse:
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")

    token = get_bearer_token(req)
    if not token or not verify_token(token, app_password, token_secret):
        return json_response({"error": "Unauthorized"}, 401)

    try:
        body = req.get_json()
    except ValueError:
        return json_response({"error": "Invalid JSON"}, 400)

    try:
        TripDocument(**body)
    except ValidationError as exc:
        return json_response({"error": "Invalid trip document", "details": exc.errors()}, 422)

    try:
        blob_service = get_blob_service_client()
        write_trip(body, blob_service)
        return json_response({"status": "ok"})
    except Exception as exc:
        logging.error("PUT /api/trip error: %s", exc)
        return json_response({"error": "Failed to write trip"}, 500)


# ---------------------------------------------------------------------------
# Memories helpers
# ---------------------------------------------------------------------------


def read_memories(blob_service: BlobServiceClient) -> dict:
    container = os.environ.get("STORAGE_MEMORIES_CONTAINER", "memories")
    blob = blob_service.get_blob_client(container=container, blob="memories.json")
    try:
        data = blob.download_blob().readall()
        return json.loads(data)
    except Exception:
        # File doesn't exist yet — return an empty document
        return {"memories": []}


def write_memories(memories_doc: dict, blob_service: BlobServiceClient) -> None:
    container = os.environ.get("STORAGE_MEMORIES_CONTAINER", "memories")
    blob = blob_service.get_blob_client(container=container, blob="memories.json")
    blob.upload_blob(json.dumps(memories_doc, ensure_ascii=False), overwrite=True)


# ---------------------------------------------------------------------------
# Memories routes
# ---------------------------------------------------------------------------


def _auth_check(req: func.HttpRequest) -> bool:
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")
    token = get_bearer_token(req)
    return bool(token and verify_token(token, app_password, token_secret))


@app.route(route="memories", methods=["GET"])
def api_memories_get(req: func.HttpRequest) -> func.HttpResponse:
    if not _auth_check(req):
        return json_response({"error": "Unauthorized"}, 401)
    try:
        blob_service = get_blob_service_client()
        doc = read_memories(blob_service)
        return json_response(doc)
    except Exception as exc:
        logging.error("GET /api/memories error: %s", exc)
        return json_response({"error": "Failed to read memories"}, 500)


@app.route(route="memories", methods=["POST"])
def api_memories_post(req: func.HttpRequest) -> func.HttpResponse:
    if not _auth_check(req):
        return json_response({"error": "Unauthorized"}, 401)

    try:
        body = req.get_json()
    except ValueError:
        return json_response({"error": "Invalid JSON"}, 400)

    if not body.get("title") or not body.get("date"):
        return json_response({"error": "title and date are required"}, 422)

    now = datetime.now(timezone.utc).isoformat()
    memory = {
        "memoryId": body.get("memoryId") or __import__("uuid").uuid4().hex,
        "title": body["title"],
        "date": body["date"],
        "time": body.get("time") or None,
        "location": body.get("location") or None,
        "notes": body.get("notes") or None,
        "linkedItemId": body.get("linkedItemId") or None,
        "photos": body.get("photos") or [],
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        blob_service = get_blob_service_client()
        doc = read_memories(blob_service)
        doc["memories"].append(memory)
        write_memories(doc, blob_service)
        return json_response(memory, 201)
    except Exception as exc:
        logging.error("POST /api/memories error: %s", exc)
        return json_response({"error": "Failed to save memory"}, 500)


@app.route(route="memories/{memory_id}", methods=["PUT"])
def api_memories_put(req: func.HttpRequest) -> func.HttpResponse:
    if not _auth_check(req):
        return json_response({"error": "Unauthorized"}, 401)

    memory_id = req.route_params.get("memory_id")

    try:
        body = req.get_json()
    except ValueError:
        return json_response({"error": "Invalid JSON"}, 400)

    if not body.get("title") or not body.get("date"):
        return json_response({"error": "title and date are required"}, 422)

    try:
        blob_service = get_blob_service_client()
        doc = read_memories(blob_service)
        memories = doc["memories"]
        idx = next((i for i, m in enumerate(memories) if m["memoryId"] == memory_id), None)
        if idx is None:
            return json_response({"error": "Memory not found"}, 404)

        updated = {
            **memories[idx],
            "title": body["title"],
            "date": body["date"],
            "time": body.get("time") or None,
            "location": body.get("location") or None,
            "notes": body.get("notes") or None,
            "linkedItemId": body.get("linkedItemId") or None,
            "photos": body.get("photos", memories[idx].get("photos", [])),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        memories[idx] = updated
        write_memories(doc, blob_service)
        return json_response(updated)
    except Exception as exc:
        logging.error("PUT /api/memories/%s error: %s", memory_id, exc)
        return json_response({"error": "Failed to update memory"}, 500)


@app.route(route="memories/{memory_id}", methods=["DELETE"])
def api_memories_delete(req: func.HttpRequest) -> func.HttpResponse:
    if not _auth_check(req):
        return json_response({"error": "Unauthorized"}, 401)

    memory_id = req.route_params.get("memory_id")

    try:
        blob_service = get_blob_service_client()
        doc = read_memories(blob_service)
        before = len(doc["memories"])
        doc["memories"] = [m for m in doc["memories"] if m["memoryId"] != memory_id]
        if len(doc["memories"]) == before:
            return json_response({"error": "Memory not found"}, 404)
        write_memories(doc, blob_service)
        return json_response({"status": "ok"})
    except Exception as exc:
        logging.error("DELETE /api/memories/%s error: %s", memory_id, exc)
        return json_response({"error": "Failed to delete memory"}, 500)
