import uuid
from typing import List, Optional

from pydantic import BaseModel, Field

from app.enums import LocationRole, PointType, StayType, TravelMode


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Auth ────────────────────────────────────────────────────────────────────

class AuthResponse(BaseModel):
    token: str
    mapsApiKey: str


# ── Trip header ─────────────────────────────────────────────────────────────

class TripHeader(BaseModel):
    tripId: str
    tripName: str
    startDate: str
    endDate: str


# ── Location ────────────────────────────────────────────────────────────────

class LocationCreate(BaseModel):
    locationId: str = Field(default_factory=_uuid)
    role: LocationRole
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    fullAddress: Optional[str] = None
    description: Optional[str] = None
    link: Optional[str] = None
    googlePlaceId: Optional[str] = None
    googleMapsUri: Optional[str] = None


class LocationResponse(BaseModel):
    locationId: str
    pointId: str
    role: LocationRole
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    fullAddress: Optional[str] = None
    description: Optional[str] = None
    link: Optional[str] = None
    googlePlaceId: Optional[str] = None
    googleMapsUri: Optional[str] = None


# ── Type-specific details ────────────────────────────────────────────────────

class TravelDetail(BaseModel):
    travelDetailId: str = Field(default_factory=_uuid)
    tripId: Optional[str] = None
    pointId: Optional[str] = None
    mode: TravelMode
    operator: Optional[str] = None
    vehicleNumber: Optional[str] = None
    cabinClass: Optional[str] = None


class StayDetail(BaseModel):
    stayDetailId: str = Field(default_factory=_uuid)
    tripId: Optional[str] = None
    pointId: Optional[str] = None
    stayType: StayType
    checkInTime: Optional[str] = None
    checkOutTime: Optional[str] = None
    roomType: Optional[str] = None


class TravelDetailPatch(BaseModel):
    mode: Optional[TravelMode] = None
    operator: Optional[str] = None
    vehicleNumber: Optional[str] = None
    cabinClass: Optional[str] = None


class StayDetailPatch(BaseModel):
    stayType: Optional[StayType] = None
    checkInTime: Optional[str] = None
    checkOutTime: Optional[str] = None
    roomType: Optional[str] = None


# ── Trip Day ────────────────────────────────────────────────────────────────

class TripDayCreate(BaseModel):
    dayId: str
    title: str
    date: str
    description: Optional[str] = None
    isAlternate: bool = False
    completed: bool = False


class TripDayUpdate(BaseModel):
    title: str
    date: str
    description: Optional[str] = None
    isAlternate: bool = False
    completed: bool = False


class TripDayPatch(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = None
    isAlternate: Optional[bool] = None
    completed: Optional[bool] = None


class TripDayResponse(BaseModel):
    dayId: str
    tripId: str
    title: str
    date: str
    description: Optional[str] = None
    isAlternate: bool = False
    completed: bool
    deletedAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


# ── Trip Point ───────────────────────────────────────────────────────────────

class TripPointCreate(BaseModel):
    pointId: str = Field(default_factory=_uuid)
    dayId: Optional[str] = None
    type: PointType
    title: str
    startDateTime: Optional[str] = None
    endDateTime: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: List[LocationCreate] = []
    travelDetail: Optional[TravelDetail] = None
    stayDetail: Optional[StayDetail] = None
    completed: bool = False
    completedDateTime: Optional[str] = None


class TripPointUpdate(BaseModel):
    dayId: str
    type: PointType
    title: str
    startDateTime: Optional[str] = None
    endDateTime: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: List[LocationCreate] = []
    travelDetail: Optional[TravelDetail] = None
    stayDetail: Optional[StayDetail] = None
    completed: bool = False
    completedDateTime: Optional[str] = None


class TripPointPatch(BaseModel):
    dayId: Optional[str] = None
    type: Optional[PointType] = None
    title: Optional[str] = None
    startDateTime: Optional[str] = None
    endDateTime: Optional[str] = None
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: Optional[List[LocationCreate]] = None
    travelDetail: Optional[TravelDetail] = None
    stayDetail: Optional[StayDetail] = None
    completed: Optional[bool] = None
    completedDateTime: Optional[str] = None


class TripPointResponse(BaseModel):
    pointId: str
    tripId: str
    dayId: str
    type: PointType
    title: str
    startDateTime: str
    endDateTime: str
    confirmationNumber: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: List[LocationResponse] = []
    travelDetail: Optional[TravelDetail] = None
    stayDetail: Optional[StayDetail] = None
    completed: bool
    completedDateTime: Optional[str] = None
    deletedAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


# ── Assembled trip response ──────────────────────────────────────────────────

class TripDayWithPoints(TripDayResponse):
    points: List[TripPointResponse] = []


class TripListItem(BaseModel):
    tripId: str
    tripName: str
    startDate: str
    endDate: str


class TripResponse(BaseModel):
    tripId: str
    tripName: str
    startDate: str
    endDate: str
    days: List[TripDayWithPoints] = []


# ── Import ───────────────────────────────────────────────────────────────────

class TripDayImport(BaseModel):
    dayId: str = Field(default_factory=_uuid)
    title: str
    date: str
    description: Optional[str] = None
    isAlternate: bool = False
    completed: bool = False
    points: List[TripPointCreate] = []


class TripImport(BaseModel):
    tripId: str = Field(default_factory=_uuid)
    tripName: str
    startDate: str
    endDate: str
    days: List[TripDayImport] = []


class ImportResult(BaseModel):
    status: str
    tripId: str
    daysImported: int
    pointsImported: int


# ── Verify ───────────────────────────────────────────────────────────────────

class VerifyIssue(BaseModel):
    code: str
    severity: str  # "error" | "warning"
    date: str
    dayId: Optional[str] = None
    message: str


class VerifyResult(BaseModel):
    ok: bool
    daysChecked: int
    issues: List[VerifyIssue] = []
