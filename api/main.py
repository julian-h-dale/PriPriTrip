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
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError


# ---------------------------------------------------------------------------
# Pydantic models — light validation only
# ---------------------------------------------------------------------------


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


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    schema.setdefault("components", {})["securitySchemes"] = {
        "BearerAuth": {"type": "http", "scheme": "bearer"}
    }
    schema["security"] = [{"BearerAuth": []}]
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi

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



