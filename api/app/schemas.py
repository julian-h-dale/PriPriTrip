"""API request/response schemas.

Python code uses snake_case field names; the wire format stays camelCase via
the `to_camel` alias generator (FastAPI serializes response models by alias
by default, and `populate_by_name=True` lets requests/constructors use either
form). The `from_record` classmethods replace the old app/serializers.py.

NOTE: the OpenAI structured-output models (app/services/llm_contract.py and
the AI* models in app/services/trip_ai.py) are deliberately NOT converted —
their camelCase field names are part of the LLM contract.
"""

import uuid
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.enums import AIDocumentType, AIDocumentWorkflowMode, LocationRole, PointType, StayType, TravelMode
from app.services.timezones import wall_clock_to_text


def _uuid() -> str:
    return str(uuid.uuid4())


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── Auth ────────────────────────────────────────────────────────────────────

class LoginRequest(APIModel):
    email: str
    password: str


class AuthResponse(APIModel):
    token: str
    maps_api_key: str


class UserProfileLocation(APIModel):
    name: Optional[str] = None
    full_address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    google_place_id: Optional[str] = None
    google_maps_uri: Optional[str] = None


class UserProfileResponse(APIModel):
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    home_location: UserProfileLocation = UserProfileLocation()
    home_timezone_id: Optional[str] = None
    phone_number: Optional[str] = None


class UserProfileUpdate(APIModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    home_location: Optional[UserProfileLocation] = None
    home_timezone_id: Optional[str] = None
    phone_number: Optional[str] = None


class TimezoneLookupRequest(APIModel):
    lat: float
    lng: float


class TimezoneLookupResponse(APIModel):
    timezone_id: Optional[str] = None


# ── Trip header ─────────────────────────────────────────────────────────────

class TripHeader(APIModel):
    # Optional: the PUT /trips/{trip_id} path segment is authoritative.
    trip_id: Optional[str] = None
    trip_name: str
    start_location_name: Optional[str] = None
    destination_location_name: Optional[str] = None
    default_timezone_id: Optional[str] = None
    start_date: str
    end_date: str


class TripHeaderResponse(APIModel):
    trip_id: str
    trip_name: str
    start_date: str
    end_date: str
    status: str


# ── Location ────────────────────────────────────────────────────────────────

class LocationCreate(APIModel):
    location_id: str = Field(default_factory=_uuid)
    role: LocationRole
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    full_address: Optional[str] = None
    description: Optional[str] = None
    link: Optional[str] = None
    google_place_id: Optional[str] = None
    google_maps_uri: Optional[str] = None
    timezone_id: Optional[str] = None


class LocationResponse(APIModel):
    location_id: str
    # Exactly one owner is set depending on what the location is attached to.
    point_id: Optional[str] = None
    stay_detail_id: Optional[str] = None
    travel_detail_id: Optional[str] = None
    role: LocationRole
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    full_address: Optional[str] = None
    description: Optional[str] = None
    link: Optional[str] = None
    google_place_id: Optional[str] = None
    google_maps_uri: Optional[str] = None
    timezone_id: Optional[str] = None


def _location_responses(locations: list | None) -> List[LocationResponse]:
    ordered = sorted(locations or [], key=lambda loc: loc.sort_order)
    return [LocationResponse.model_validate(loc) for loc in ordered]


# ── Travel / Stay details (first-class trip entities) ────────────────────────

class TravelDetail(APIModel):
    travel_detail_id: str = Field(default_factory=_uuid)
    trip_id: Optional[str] = None
    name: Optional[str] = None
    mode: TravelMode
    operator: Optional[str] = None
    vehicle_number: Optional[str] = None
    cabin_class: Optional[str] = None
    departure_date_time: Optional[str] = None
    departure_timezone_id: Optional[str] = None
    arrival_date_time: Optional[str] = None
    arrival_timezone_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    locations: List[LocationResponse] = []

    @classmethod
    def from_record(cls, rec, locations: list | None = None) -> "TravelDetail":
        return cls(
            travel_detail_id=rec.travel_detail_id,
            trip_id=rec.trip_id,
            name=rec.name,
            mode=rec.mode,
            operator=rec.operator,
            vehicle_number=rec.vehicle_number,
            cabin_class=rec.cabin_class,
            departure_date_time=wall_clock_to_text(rec.departure_local) or rec.departure_date_time,
            departure_timezone_id=rec.departure_tzid,
            arrival_date_time=wall_clock_to_text(rec.arrival_local) or rec.arrival_date_time,
            arrival_timezone_id=rec.arrival_tzid,
            confirmation_number=rec.confirmation_number,
            description=rec.description,
            locations=_location_responses(locations),
        )


class StayDetail(APIModel):
    stay_detail_id: str = Field(default_factory=_uuid)
    trip_id: Optional[str] = None
    name: Optional[str] = None
    stay_type: StayType
    check_in: Optional[str] = None
    check_in_timezone_id: Optional[str] = None
    check_out: Optional[str] = None
    check_out_timezone_id: Optional[str] = None
    room_type: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    locations: List[LocationResponse] = []

    @classmethod
    def from_record(cls, rec, locations: list | None = None) -> "StayDetail":
        return cls(
            stay_detail_id=rec.stay_detail_id,
            trip_id=rec.trip_id,
            name=rec.name,
            stay_type=rec.stay_type,
            check_in=wall_clock_to_text(rec.check_in_local) or rec.check_in,
            check_in_timezone_id=rec.check_in_tzid,
            check_out=wall_clock_to_text(rec.check_out_local) or rec.check_out,
            check_out_timezone_id=rec.check_out_tzid,
            room_type=rec.room_type,
            confirmation_number=rec.confirmation_number,
            description=rec.description,
            locations=_location_responses(locations),
        )


class TravelDetailImport(APIModel):
    travel_detail_id: str = Field(default_factory=_uuid)
    name: Optional[str] = None
    mode: TravelMode
    operator: Optional[str] = None
    vehicle_number: Optional[str] = None
    cabin_class: Optional[str] = None
    departure_date_time: Optional[str] = None
    departure_timezone_id: Optional[str] = None
    arrival_date_time: Optional[str] = None
    arrival_timezone_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    locations: List[LocationCreate] = []


class StayDetailImport(APIModel):
    stay_detail_id: str = Field(default_factory=_uuid)
    name: Optional[str] = None
    stay_type: StayType
    check_in: Optional[str] = None
    check_in_timezone_id: Optional[str] = None
    check_out: Optional[str] = None
    check_out_timezone_id: Optional[str] = None
    room_type: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    locations: List[LocationCreate] = []


class TravelDetailPatch(APIModel):
    name: Optional[str] = None
    mode: Optional[TravelMode] = None
    operator: Optional[str] = None
    vehicle_number: Optional[str] = None
    cabin_class: Optional[str] = None
    departure_date_time: Optional[str] = None
    departure_timezone_id: Optional[str] = None
    arrival_date_time: Optional[str] = None
    arrival_timezone_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[List[LocationCreate]] = None


class StayDetailPatch(APIModel):
    name: Optional[str] = None
    stay_type: Optional[StayType] = None
    check_in: Optional[str] = None
    check_in_timezone_id: Optional[str] = None
    check_out: Optional[str] = None
    check_out_timezone_id: Optional[str] = None
    room_type: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    locations: Optional[List[LocationCreate]] = None


# ── Trip Day ────────────────────────────────────────────────────────────────

class TripDayCreate(APIModel):
    day_id: str
    title: str
    date: str
    description: Optional[str] = None
    is_alternate: bool = False
    completed: bool = False


class TripDayPatch(APIModel):
    title: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = None
    is_alternate: Optional[bool] = None
    completed: Optional[bool] = None


class TripDayResponse(APIModel):
    day_id: str
    trip_id: str
    title: str
    date: str
    description: Optional[str] = None
    is_alternate: bool = False
    completed: bool
    deleted_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @classmethod
    def from_record(cls, r) -> "TripDayResponse":
        return cls(**_day_fields(r))


def _day_fields(r) -> dict:
    return dict(
        day_id=r.day_id,
        trip_id=r.trip_id,
        title=r.title,
        date=r.date,
        description=r.description,
        is_alternate=r.is_alternate,
        completed=r.completed,
        deleted_at=r.deleted_at.isoformat() if r.deleted_at else None,
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


# ── Trip Point ───────────────────────────────────────────────────────────────

class TripPointCreate(APIModel):
    point_id: str = Field(default_factory=_uuid)
    day_id: Optional[str] = None
    type: PointType
    title: str
    stay_detail_id: Optional[str] = None
    travel_detail_id: Optional[str] = None
    start_date_time: Optional[str] = None
    start_timezone_id: Optional[str] = None
    end_date_time: Optional[str] = None
    end_timezone_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    logo_url: Optional[str] = None
    locations: List[LocationCreate] = []
    is_system_created: bool = False
    completed: bool = False
    completed_date_time: Optional[str] = None


class TripPointPatch(APIModel):
    day_id: Optional[str] = None
    type: Optional[PointType] = None
    title: Optional[str] = None
    stay_detail_id: Optional[str] = None
    travel_detail_id: Optional[str] = None
    start_date_time: Optional[str] = None
    start_timezone_id: Optional[str] = None
    end_date_time: Optional[str] = None
    end_timezone_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    logo_url: Optional[str] = None
    locations: Optional[List[LocationCreate]] = None
    is_system_created: Optional[bool] = None
    completed: Optional[bool] = None
    completed_date_time: Optional[str] = None


class TripPointResponse(APIModel):
    point_id: str
    trip_id: str
    day_id: str
    type: PointType
    title: str
    stay_detail_id: Optional[str] = None
    travel_detail_id: Optional[str] = None
    start_date_time: Optional[str] = None
    start_timezone_id: Optional[str] = None
    end_date_time: Optional[str] = None
    end_timezone_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    logo_url: Optional[str] = None
    locations: List[LocationResponse] = []
    is_system_created: bool = False
    # The referenced first-class detail, embedded for convenience.
    travel_detail: Optional[TravelDetail] = None
    stay_detail: Optional[StayDetail] = None
    completed: bool
    completed_date_time: Optional[str] = None
    deleted_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @classmethod
    def from_record(
        cls,
        point,
        locations: list,
        travel: Optional[TravelDetail] = None,
        stay: Optional[StayDetail] = None,
    ) -> "TripPointResponse":
        return cls(
            point_id=point.point_id,
            trip_id=point.trip_id,
            day_id=point.day_id,
            type=point.type,
            title=point.title,
            stay_detail_id=point.stay_detail_id,
            travel_detail_id=point.travel_detail_id,
            start_date_time=wall_clock_to_text(point.start_local) or point.start_date_time,
            start_timezone_id=point.start_tzid,
            end_date_time=wall_clock_to_text(point.end_local) or point.end_date_time,
            end_timezone_id=point.end_tzid,
            confirmation_number=point.confirmation_number,
            description=point.description,
            image_url=point.image_url,
            logo_url=point.logo_url,
            locations=_location_responses(locations),
            is_system_created=point.is_system_created,
            travel_detail=travel,
            stay_detail=stay,
            completed=point.completed,
            completed_date_time=point.completed_date_time,
            deleted_at=point.deleted_at.isoformat() if point.deleted_at else None,
            created_at=point.created_at.isoformat() if point.created_at else None,
            updated_at=point.updated_at.isoformat() if point.updated_at else None,
        )


# ── Assembled trip response ──────────────────────────────────────────────────

class TripDayWithPoints(TripDayResponse):
    points: List[TripPointResponse] = []

    @classmethod
    def from_record(cls, r, points: Optional[List[TripPointResponse]] = None) -> "TripDayWithPoints":
        return cls(points=points or [], **_day_fields(r))


class TripListItem(APIModel):
    trip_id: str
    trip_name: str
    start_date: str
    end_date: str


class TripResponse(APIModel):
    trip_id: str
    trip_name: str
    status: str
    start_location_name: Optional[str] = None
    destination_location_name: Optional[str] = None
    default_timezone_id: Optional[str] = None
    start_date: str
    end_date: str
    stays: List[StayDetail] = []
    travels: List[TravelDetail] = []
    days: List[TripDayWithPoints] = []


# ── Import ───────────────────────────────────────────────────────────────────

class TripDayImport(APIModel):
    day_id: str = Field(default_factory=_uuid)
    title: str
    date: str
    description: Optional[str] = None
    is_alternate: bool = False
    completed: bool = False
    points: List[TripPointCreate] = []


class TripImport(APIModel):
    trip_id: str = Field(default_factory=_uuid)
    trip_name: str
    default_timezone_id: Optional[str] = None
    start_date: str
    end_date: str
    stays: List[StayDetailImport] = []
    travels: List[TravelDetailImport] = []
    days: List[TripDayImport] = []


class ImportResult(APIModel):
    status: str
    trip_id: str
    days_imported: int
    points_imported: int
    stays_imported: int = 0
    travels_imported: int = 0


class AIDocumentExtraction(APIModel):
    document_id: str
    trip_id: str
    filename: str
    document_type: AIDocumentType = AIDocumentType.DETAIL
    workflow_mode: AIDocumentWorkflowMode = AIDocumentWorkflowMode.DETAIL_IMPORT
    cached: bool = False
    stays: List[StayDetailImport] = []
    travels: List[TravelDetailImport] = []


class AIDocumentSaveRequest(APIModel):
    stays: Optional[List[StayDetailImport]] = None
    travels: Optional[List[TravelDetailImport]] = None
    stay_detail_ids: Optional[List[str]] = None
    travel_detail_ids: Optional[List[str]] = None


class AIDocumentSaveResult(APIModel):
    status: str
    trip_id: str
    document_id: str
    stays_saved: int
    travels_saved: int


class AIDocumentListItem(APIModel):
    document_id: str
    trip_id: str
    filename: str
    document_type: AIDocumentType = AIDocumentType.DETAIL
    workflow_mode: AIDocumentWorkflowMode = AIDocumentWorkflowMode.DETAIL_IMPORT
    stays_extracted: int = 0
    travels_extracted: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ── Verify ───────────────────────────────────────────────────────────────────

class VerifyIssue(APIModel):
    code: str
    severity: str  # "error" | "warning"
    date: str
    day_id: Optional[str] = None
    message: str


class VerifyResult(APIModel):
    ok: bool
    days_checked: int
    issues: List[VerifyIssue] = []


class ChatMessageResponse(APIModel):
    message_id: str
    trip_id: str
    workflow_name: str
    message: str
    structure_content: Optional[str] = None
    is_bot: bool
    created_at: Optional[str] = None


# ── Dynamic chat forms (review.md 3F-2) ─────────────────────────────────────

class ChatFormOption(APIModel):
    value: str
    label: str


class ChatFormField(APIModel):
    name: str
    label: str
    # text | textarea | date | datetime | select — the frontend renders by this.
    type: str
    value: Optional[str] = None
    options: List[ChatFormOption] = []
    help_text: Optional[str] = None


class ChatForm(APIModel):
    form_id: str
    title: str
    submit_label: str
    # trip | day | point | stay | travel
    target: str
    # None means the form creates a new record.
    record_id: Optional[str] = None
    fields: List[ChatFormField] = []


class ChatFormSubmitRequest(APIModel):
    trip_id: str
    workflow_name: str
    request_id: str  # same idempotency contract as /chat/reply (review.md 3D-5)
    form_id: str
    target: str
    record_id: Optional[str] = None
    values: dict


class ChatReplyRequest(APIModel):
    trip_id: Optional[str] = None
    workflow_name: str
    message: str
    context: Optional[dict] = None
    # Client-generated id for this send; required. Repeating it replays the
    # original reply instead of running the pipeline twice (review.md 3D-5).
    # Not optional by design: an optional key means the protection is off by
    # default, and the frontend is updated in lockstep anyway.
    request_id: str


class ChatReplyResponse(APIModel):
    trip_id: str
    complete: bool = False
    trip_name: Optional[str] = None
    verify: Optional[VerifyResult] = None
    messages: List[ChatMessageResponse] = []
