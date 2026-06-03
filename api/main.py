import copy
import hashlib
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager, contextmanager
from typing import Generator, List, Literal, Optional

import psycopg2.extensions

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError


# ---------------------------------------------------------------------------
# Pydantic models — light validation only
# ---------------------------------------------------------------------------


class DocumentModel(BaseModel):
    url: str
    name: str
    description: Optional[str] = None


class LocationModel(BaseModel):
    name: str
    lat: Optional[float] = None
    long: Optional[float] = None
    fullAddress: Optional[str] = None
    description: Optional[str] = None
    link: Optional[str] = None


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
    locations: List[LocationModel] = []
    documents: List[DocumentModel] = []
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
    # HMAC-SHA256 is used here to generate a *bearer token*, not to store a password.
    # The password is verified separately via hmac.compare_digest (see api_auth).
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
# Database helpers
# ---------------------------------------------------------------------------


def get_database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/pripritrip"
    )


@contextmanager
def get_db_connection() -> Generator[psycopg2.extensions.connection, None, None]:
    """Yield a psycopg2 connection; commit on success, rollback on error."""
    conn = psycopg2.connect(get_database_url())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def create_tables() -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS trips (
                    trip_id TEXT PRIMARY KEY,
                    data    JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    blob_name    TEXT PRIMARY KEY,
                    content      BYTEA NOT NULL,
                    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                    original_name TEXT,
                    created_at   TIMESTAMPTZ DEFAULT NOW()
                )
                """
            )


# ---------------------------------------------------------------------------
# Trip storage helpers
# ---------------------------------------------------------------------------


def read_trip(conn: psycopg2.extensions.connection) -> dict:
    # Returns the most recently updated trip; this API manages a single trip document.
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM trips ORDER BY updated_at DESC LIMIT 1")
        row = cur.fetchone()
        if row is None:
            raise ValueError("No trip found")
        return dict(row["data"])


def write_trip(trip: dict, conn: psycopg2.extensions.connection) -> None:
    trip_id = trip.get("tripId", "default")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO trips (trip_id, data, updated_at)
            VALUES (%s, %s::jsonb, NOW())
            ON CONFLICT (trip_id) DO UPDATE
                SET data = EXCLUDED.data, updated_at = NOW()
            """,
            (trip_id, json.dumps(trip)),
        )


def resolve_document_urls(trip: dict) -> dict:
    """Replace bare blob names in document URL fields with API document paths.

    Stored document ``url`` values that do not start with ``http`` are treated
    as blob names and rewritten to ``/documents/{blob_name}`` so the client can
    fetch them from this API.  Full HTTP(S) URLs are left unchanged.
    """
    trip = copy.deepcopy(trip)
    for item in trip.get("items", []):
        for doc in item.get("documents", []):
            url = doc.get("url", "")
            if url and not url.startswith("http"):
                doc["url"] = f"/documents/{url}"
    return trip


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        create_tables()
    except Exception as exc:
        logging.warning("Could not initialize database tables on startup: %s", exc)
    yield


app = FastAPI(title="PriPriTrip API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@app.get("/health")
async def api_health():
    return {"status": "ok"}


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
        with get_db_connection() as conn:
            trip = read_trip(conn)
        trip = resolve_document_urls(trip)
        return trip
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No trip found")
    except Exception as exc:
        logging.error("GET /trip error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to read trip"
        )


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
        with get_db_connection() as conn:
            write_trip(body, conn)
        return {"status": "ok"}
    except Exception as exc:
        logging.error("POST /trip error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to write trip"
        )


@app.post("/documents/{blob_name:path}", status_code=status.HTTP_201_CREATED)
async def api_document_upload(blob_name: str, request: Request):
    """Upload a document binary and store it in the database."""
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")

    token = get_bearer_token(request)
    if not token or not verify_token(token, app_password, token_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    content = await request.body()
    content_type = request.headers.get("Content-Type", "application/octet-stream")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO documents (blob_name, content, content_type)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (blob_name) DO UPDATE
                        SET content = EXCLUDED.content,
                            content_type = EXCLUDED.content_type
                    """,
                    (blob_name, psycopg2.Binary(content), content_type),
                )
        return {"status": "ok", "blobName": blob_name}
    except Exception as exc:
        logging.error("POST /documents/%s error: %s", blob_name, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store document"
        )


@app.get("/documents/{blob_name:path}")
async def api_document_get(blob_name: str, request: Request):
    """Retrieve a stored document by its blob name."""
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")

    token = get_bearer_token(request)
    if not token or not verify_token(token, app_password, token_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT content, content_type FROM documents WHERE blob_name = %s",
                    (blob_name,),
                )
                row = cur.fetchone()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
            )
        content, content_type = row
        return Response(content=bytes(content), media_type=content_type)
    except HTTPException:
        raise
    except Exception as exc:
        logging.error("GET /documents/%s error: %s", blob_name, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to read document"
        )

