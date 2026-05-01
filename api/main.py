import copy
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from azure.identity import DefaultAzureCredential
from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    generate_blob_sas,
)
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

app = FastAPI(title="PriPriTrip API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class AuthRequest(BaseModel):
    password: str


class AuthResponse(BaseModel):
    token: str
    mapsApiKey: str


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def make_token(password: str, secret: str) -> str:
    return hmac.new(secret.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_token(token: str, app_password: str, secret: str) -> bool:
    expected = make_token(app_password, secret)
    return hmac.compare_digest(expected, token)


def get_bearer_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


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


@app.post("/auth")
async def api_auth(body: AuthRequest):
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")

    if not hmac.compare_digest(body.password, app_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")
    token = make_token(body.password, token_secret)
    maps_api_key = os.environ.get("MAPS_API_KEY", "")

    return {"token": token, "mapsApiKey": maps_api_key}


@app.get("/trip")
async def api_trip_get(request: Request):
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")

    token = get_bearer_token(request)
    if not token or not verify_token(token, app_password, token_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    try:
        blob_service = get_blob_service_client()
        trip = read_trip(blob_service)
        trip = resolve_document_sas_urls(trip, blob_service)
        return trip
    except Exception as exc:
        logging.error("GET /trip error: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to read trip")


@app.post("/trip")
async def api_trip_post(request: Request):
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")

    token = get_bearer_token(request)
    if not token or not verify_token(token, app_password, token_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")

    try:
        TripDocument(**body)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "Invalid trip document", "details": exc.errors()},
        )

    try:
        blob_service = get_blob_service_client()
        write_trip(body, blob_service)
        return {"status": "ok"}
    except Exception as exc:
        logging.error("POST /trip error: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to write trip")
