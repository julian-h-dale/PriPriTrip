import hashlib
import hmac
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Generator, List, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, String, create_engine, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


# ---------------------------------------------------------------------------
# Pydantic models
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
# Auth
# ---------------------------------------------------------------------------

_security = HTTPBearer(auto_error=False)


def make_token(password: str, secret: str) -> str:
    # HMAC-SHA256 is used here to generate a *bearer token*, not to store a password.
    # The password is verified separately via hmac.compare_digest (see api_auth).
    return hmac.new(secret.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_token(token: str, app_password: str, secret: str) -> bool:
    expected = make_token(app_password, secret)
    return hmac.compare_digest(expected, token)


def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")
    if not verify_token(credentials.credentials, app_password, token_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def get_database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/pripritrip"
    )


class Base(DeclarativeBase):
    pass


class TripRecord(Base):
    __tablename__ = "trips"

    trip_id = Column(String, primary_key=True)
    data = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


engine = create_engine(get_database_url())
SessionLocal = sessionmaker(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def read_trip(db: Session) -> dict:
    record = db.query(TripRecord).order_by(TripRecord.updated_at.desc()).first()
    if record is None:
        raise ValueError("No trip found")
    return record.data


def write_trip(trip: dict, db: Session) -> None:
    trip_id = trip.get("tripId", "default")
    record = db.get(TripRecord, trip_id)
    if record is None:
        db.add(TripRecord(trip_id=trip_id, data=trip))
    else:
        record.data = trip
        record.updated_at = datetime.now(timezone.utc)
    db.commit()


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(engine)
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


@app.get("/trip", dependencies=[Depends(require_auth)])
async def api_trip_get(db: Session = Depends(get_db)):
    try:
        return read_trip(db)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No trip found")
    except Exception as exc:
        logging.error("GET /trip error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to read trip"
        )


@app.post("/trip", dependencies=[Depends(require_auth)])
async def api_trip_post(body: TripDocument, db: Session = Depends(get_db)):
    try:
        write_trip(body.model_dump(), db)
        return {"status": "ok"}
    except Exception as exc:
        logging.error("POST /trip error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to write trip"
        )



