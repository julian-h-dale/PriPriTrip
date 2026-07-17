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
from datetime import date as CalendarDate
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.enums import (
    AIDocumentType,
    AIDocumentWorkflowMode,
    LocationRole,
    PointType,
    StayType,
    TravelMode,
    TripStatus,
)
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
    name: str | None = None
    full_address: str | None = None
    lat: float | None = None
    lng: float | None = None
    google_place_id: str | None = None
    google_maps_uri: str | None = None


class UserProfileResponse(APIModel):
    email: str
    first_name: str | None = None
    last_name: str | None = None
    home_location: UserProfileLocation = UserProfileLocation()
    home_timezone_id: str | None = None
    phone_number: str | None = None


class UserProfileUpdate(APIModel):
    first_name: str | None = None
    last_name: str | None = None
    home_location: UserProfileLocation | None = None
    home_timezone_id: str | None = None
    phone_number: str | None = None


class TimezoneLookupRequest(APIModel):
    lat: float
    lng: float


class TimezoneLookupResponse(APIModel):
    timezone_id: str | None = None


# ── Trip header ─────────────────────────────────────────────────────────────

class TripHeader(APIModel):
    # Optional: the PUT /trips/{trip_id} path segment is authoritative.
    trip_id: str | None = None
    trip_name: str
    start_location_name: str | None = None
    destination_location_name: str | None = None
    default_timezone_id: str | None = None
    start_date: CalendarDate
    end_date: CalendarDate


class TripHeaderResponse(APIModel):
    trip_id: str
    trip_name: str
    start_date: CalendarDate
    end_date: CalendarDate
    status: str


class TripPatch(APIModel):
    """A partial trip-header update.

    `model_fields_set` is what tells the write layer which columns the caller
    actually touched — an absent key means "leave it", an explicit null means
    "clear it".
    """

    trip_name: str | None = None
    status: TripStatus | None = None
    start_location_name: str | None = None
    destination_location_name: str | None = None
    default_timezone_id: str | None = None
    start_date: CalendarDate | None = None
    end_date: CalendarDate | None = None


class TripStatusUpdate(APIModel):
    """Move a trip between planning and being on it (docs/active_trip_plan.md).

    Typed as the enum, so an unknown status is a 422 rather than a string that
    quietly lands in the column and strands the UI.
    """

    status: TripStatus


# ── Location ────────────────────────────────────────────────────────────────

class LocationCreate(APIModel):
    location_id: str = Field(default_factory=_uuid)
    role: LocationRole
    name: str
    lat: float | None = None
    lng: float | None = None
    full_address: str | None = None
    description: str | None = None
    link: str | None = None
    google_place_id: str | None = None
    google_maps_uri: str | None = None
    timezone_id: str | None = None


class LocationResponse(APIModel):
    location_id: str
    # Exactly one owner is set depending on what the location is attached to.
    point_id: str | None = None
    stay_detail_id: str | None = None
    travel_detail_id: str | None = None
    role: LocationRole
    name: str
    lat: float | None = None
    lng: float | None = None
    full_address: str | None = None
    description: str | None = None
    link: str | None = None
    google_place_id: str | None = None
    google_maps_uri: str | None = None
    timezone_id: str | None = None


def _location_responses(locations: list | None) -> list[LocationResponse]:
    ordered = sorted(locations or [], key=lambda loc: loc.sort_order)
    return [LocationResponse.model_validate(loc) for loc in ordered]


# ── Travel / Stay details (first-class trip entities) ────────────────────────

# The scalar field list for a travel leg lives in exactly one place (review.md
# R6/S5). It is declared all-optional here — that IS the PATCH shape — and the
# Import/response variants below re-require `mode` and add ids + the right
# `locations` type. Adding a scalar field to a travel leg is now a one-line edit
# to this base instead of three near-identical edits.
class _TravelFields(APIModel):
    name: str | None = None
    mode: TravelMode | None = None
    operator: str | None = None
    vehicle_number: str | None = None
    cabin_class: str | None = None
    departure_date_time: str | None = None
    departure_timezone_id: str | None = None
    arrival_date_time: str | None = None
    arrival_timezone_id: str | None = None
    confirmation_number: str | None = None
    description: str | None = None


class TravelDetail(_TravelFields):
    travel_detail_id: str = Field(default_factory=_uuid)
    trip_id: str | None = None
    mode: TravelMode
    locations: list[LocationResponse] = []

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
            departure_date_time=wall_clock_to_text(rec.departure_local),
            departure_timezone_id=rec.departure_tzid,
            arrival_date_time=wall_clock_to_text(rec.arrival_local),
            arrival_timezone_id=rec.arrival_tzid,
            confirmation_number=rec.confirmation_number,
            description=rec.description,
            locations=_location_responses(locations),
        )


# The scalar field list for a stay, in one place (review.md R6/S5). See _TravelFields.
class _StayFields(APIModel):
    name: str | None = None
    stay_type: StayType | None = None
    check_in: str | None = None
    check_in_timezone_id: str | None = None
    check_out: str | None = None
    check_out_timezone_id: str | None = None
    room_type: str | None = None
    confirmation_number: str | None = None
    description: str | None = None


class StayDetail(_StayFields):
    stay_detail_id: str = Field(default_factory=_uuid)
    trip_id: str | None = None
    stay_type: StayType
    locations: list[LocationResponse] = []

    @classmethod
    def from_record(cls, rec, locations: list | None = None) -> "StayDetail":
        return cls(
            stay_detail_id=rec.stay_detail_id,
            trip_id=rec.trip_id,
            name=rec.name,
            stay_type=rec.stay_type,
            check_in=wall_clock_to_text(rec.check_in_local),
            check_in_timezone_id=rec.check_in_tzid,
            check_out=wall_clock_to_text(rec.check_out_local),
            check_out_timezone_id=rec.check_out_tzid,
            room_type=rec.room_type,
            confirmation_number=rec.confirmation_number,
            description=rec.description,
            locations=_location_responses(locations),
        )


class TravelDetailImport(_TravelFields):
    travel_detail_id: str = Field(default_factory=_uuid)
    mode: TravelMode
    locations: list[LocationCreate] = []


class StayDetailImport(_StayFields):
    stay_detail_id: str = Field(default_factory=_uuid)
    stay_type: StayType
    locations: list[LocationCreate] = []


# _TravelFields is already all-optional, so the PATCH body is just the base plus a
# nullable locations list. `exclude_unset` on the router side still distinguishes
# "field omitted" from "explicitly null".
class TravelDetailPatch(_TravelFields):
    locations: list[LocationCreate] | None = None


class StayDetailPatch(_StayFields):
    locations: list[LocationCreate] | None = None


# ── Trip Day ────────────────────────────────────────────────────────────────

class TripDayCreate(APIModel):
    day_id: str
    title: str
    date: CalendarDate
    description: str | None = None
    is_alternate: bool = False
    completed: bool = False


class TripDayPatch(APIModel):
    title: str | None = None
    date: CalendarDate | None = None
    description: str | None = None
    is_alternate: bool | None = None
    completed: bool | None = None


class TripDayResponse(APIModel):
    day_id: str
    trip_id: str
    title: str
    date: CalendarDate
    description: str | None = None
    is_alternate: bool = False
    completed: bool
    deleted_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_record(cls, r) -> "TripDayResponse":
        return cls(**_day_fields(r))


def _day_fields(r) -> dict:
    return {
        "day_id": r.day_id,
        "trip_id": r.trip_id,
        "title": r.title,
        "date": r.date,
        "description": r.description,
        "is_alternate": r.is_alternate,
        "completed": r.completed,
        "deleted_at": r.deleted_at.isoformat() if r.deleted_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# ── Trip Point ───────────────────────────────────────────────────────────────

# A point's writable field list, in one place (review.md R6/S5), declared
# all-optional — that IS TripPointPatch. TripPointCreate re-requires `type`/`title`,
# adds the id, and gives the bool/locations fields their create-time defaults.
# TripPointResponse is *not* generated from this: it carries server-derived fields
# (trip_id, startUtc/endUtc, embedded details, timestamps) that a write never sends.
class _PointFields(APIModel):
    day_id: str | None = None
    type: PointType | None = None
    title: str | None = None
    stay_detail_id: str | None = None
    travel_detail_id: str | None = None
    start_date_time: str | None = None
    start_timezone_id: str | None = None
    end_date_time: str | None = None
    end_timezone_id: str | None = None
    confirmation_number: str | None = None
    description: str | None = None
    image_url: str | None = None
    logo_url: str | None = None
    locations: list[LocationCreate] | None = None
    is_system_created: bool | None = None
    completed: bool | None = None
    completed_date_time: datetime | None = None


class TripPointCreate(_PointFields):
    point_id: str = Field(default_factory=_uuid)
    type: PointType
    title: str
    locations: list[LocationCreate] = []
    is_system_created: bool = False
    completed: bool = False


class TripPointPatch(_PointFields):
    pass


class TripPointResponse(APIModel):
    point_id: str
    trip_id: str
    day_id: str
    type: PointType
    title: str
    stay_detail_id: str | None = None
    travel_detail_id: str | None = None
    start_date_time: str | None = None
    start_timezone_id: str | None = None
    end_date_time: str | None = None
    end_timezone_id: str | None = None
    # The derived instants. start_date_time is a *wall clock* ("09:00" — what the
    # ticket says), which cannot be compared to "now" without knowing the clock.
    # These can. They are what lets the What's Next screen ask "is this still
    # ahead of me?" with a plain comparison instead of timezone arithmetic in the
    # browser (docs/active_trip_plan.md).
    start_utc: datetime | None = None
    end_utc: datetime | None = None
    confirmation_number: str | None = None
    description: str | None = None
    image_url: str | None = None
    logo_url: str | None = None
    locations: list[LocationResponse] = []
    is_system_created: bool = False
    # The referenced first-class detail, embedded for convenience.
    travel_detail: TravelDetail | None = None
    stay_detail: StayDetail | None = None
    completed: bool
    completed_date_time: datetime | None = None
    deleted_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_record(
        cls,
        point,
        locations: list,
        travel: TravelDetail | None = None,
        stay: StayDetail | None = None,
    ) -> "TripPointResponse":
        return cls(
            point_id=point.point_id,
            trip_id=point.trip_id,
            day_id=point.day_id,
            type=point.type,
            title=point.title,
            stay_detail_id=point.stay_detail_id,
            travel_detail_id=point.travel_detail_id,
            start_date_time=wall_clock_to_text(point.start_local),
            start_timezone_id=point.start_tzid,
            end_date_time=wall_clock_to_text(point.end_local),
            end_timezone_id=point.end_tzid,
            start_utc=point.start_utc,
            end_utc=point.end_utc,
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
    points: list[TripPointResponse] = []

    @classmethod
    def from_record(cls, r, points: list[TripPointResponse] | None = None) -> "TripDayWithPoints":
        return cls(points=points or [], **_day_fields(r))


class TripListItem(APIModel):
    trip_id: str
    trip_name: str
    start_date: CalendarDate
    end_date: CalendarDate
    # So the list can show which trip you're actually on.
    status: str = "new"


class TripResponse(APIModel):
    trip_id: str
    trip_name: str
    # The status resolved against the clock — what the UI renders.
    status: str
    # The status *stored* on the row: "draft" = follow the dates, "active" =
    # forced on. Without it the UI cannot tell an automatically-active trip from
    # a forced one, and the status menu's checkmark would lie.
    status_intent: str = "new"
    start_location_name: str | None = None
    destination_location_name: str | None = None
    default_timezone_id: str | None = None
    start_date: CalendarDate
    end_date: CalendarDate
    stays: list[StayDetail] = []
    travels: list[TravelDetail] = []
    days: list[TripDayWithPoints] = []


# ── Sharing (docs/share_links_plan.md) ───────────────────────────────────────

class TripShareResponse(APIModel):
    """The owner's view of their share link."""

    share_id: str
    trip_id: str
    token: str
    url: str  # the whole link, ready to copy
    view_count: int
    last_viewed_at: str | None = None
    expires_at: str | None = None
    created_at: str | None = None


class SharedTripResponse(APIModel):
    """What someone holding the link sees.

    Deliberately its own type rather than a reuse of TripResponse. They carry
    the same fields today, but a field added to the owner's view later must not
    silently start leaking through a public link — it has to be added here on
    purpose. There is a test that fails if this ever carries a user id.
    """

    trip_name: str
    start_location_name: str | None = None
    destination_location_name: str | None = None
    start_date: CalendarDate
    end_date: CalendarDate
    stays: list[StayDetail] = []
    travels: list[TravelDetail] = []
    days: list[TripDayWithPoints] = []

    @classmethod
    def from_trip(cls, trip: "TripResponse") -> "SharedTripResponse":
        return cls(
            tripName=trip.trip_name,
            startLocationName=trip.start_location_name,
            destinationLocationName=trip.destination_location_name,
            startDate=trip.start_date,
            endDate=trip.end_date,
            stays=trip.stays,
            travels=trip.travels,
            days=trip.days,
        )


# ── Import ───────────────────────────────────────────────────────────────────

class TripDayImport(APIModel):
    day_id: str = Field(default_factory=_uuid)
    title: str
    date: CalendarDate
    description: str | None = None
    is_alternate: bool = False
    completed: bool = False
    points: list[TripPointCreate] = []


class TripImport(APIModel):
    trip_id: str = Field(default_factory=_uuid)
    trip_name: str
    default_timezone_id: str | None = None
    start_date: CalendarDate
    end_date: CalendarDate
    stays: list[StayDetailImport] = []
    travels: list[TravelDetailImport] = []
    days: list[TripDayImport] = []


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
    stays: list[StayDetailImport] = []
    travels: list[TravelDetailImport] = []


class AIDocumentSaveRequest(APIModel):
    stays: list[StayDetailImport] | None = None
    travels: list[TravelDetailImport] | None = None
    stay_detail_ids: list[str] | None = None
    travel_detail_ids: list[str] | None = None


class AIDocumentSaveResult(APIModel):
    status: str
    trip_id: str
    document_id: str
    stays_saved: int
    travels_saved: int



# ── Verify ───────────────────────────────────────────────────────────────────

class VerifyIssue(APIModel):
    code: str
    severity: str  # "error" | "warning"
    date: CalendarDate
    day_id: str | None = None
    message: str


class VerifyResult(APIModel):
    ok: bool
    days_checked: int
    issues: list[VerifyIssue] = []


class TripGapResponse(APIModel):
    """One fillable hole, with the form that fills it already built."""

    gap_id: str
    target: str  # "trip" | "stay" | "travel"
    record_id: str | None = None
    record_label: str
    severity: str  # "blocking" | "worth_adding"
    message: str
    fields: list[str] = []
    # The same server-owned form the chat uses (review.md 3F-2), so the banner
    # and the assistant put up exactly the same inputs.
    form: "ChatForm"


class TripGapsResponse(APIModel):
    trip_id: str
    blocking_count: int
    total_count: int
    gaps: list[TripGapResponse] = []


class TripGapSubmitRequest(APIModel):
    """Fill a gap from the trip page. Not a chat turn — no model call."""

    target: str
    record_id: str | None = None
    values: dict = {}


class ChatMessageResponse(APIModel):
    message_id: str
    trip_id: str
    workflow_name: str
    message: str
    structure_content: str | None = None
    is_bot: bool
    created_at: str | None = None


# ── Dynamic chat forms (review.md 3F-2) ─────────────────────────────────────

class ChatFormOption(APIModel):
    value: str
    label: str


class ChatFormField(APIModel):
    name: str
    label: str
    # text | textarea | date | datetime | select — the frontend renders by this.
    type: str
    value: str | None = None
    options: list[ChatFormOption] = []
    help_text: str | None = None


class ChatForm(APIModel):
    form_id: str
    title: str
    submit_label: str
    # trip | day | point | stay | travel
    target: str
    # None means the form creates a new record.
    record_id: str | None = None
    fields: list[ChatFormField] = []


# ── Location choice (review.md 3F-5) ────────────────────────────────────────

class ChatChoiceOption(APIModel):
    # The place id came from OUR Places lookup — the model never sees or
    # invents one (review.md 3C-6).
    option_id: str
    label: str
    sublabel: str | None = None
    maps_uri: str | None = None


class ChatChoice(APIModel):
    choice_id: str
    prompt: str
    # The location row whose place is being decided.
    location_id: str
    query: str
    options: list[ChatChoiceOption] = []


class ChatChoiceSubmitRequest(APIModel):
    trip_id: str
    workflow_name: str
    request_id: str  # same idempotency contract as /chat/reply (review.md 3D-5)
    choice_id: str
    # Exactly one of these. `option_id` is one of the places we offered;
    # `place_id` is one the user found through the card's own Places search,
    # because none of ours was the place they meant.
    option_id: str | None = None
    place_id: str | None = None


class ChatFormSubmitRequest(APIModel):
    trip_id: str
    workflow_name: str
    request_id: str  # same idempotency contract as /chat/reply (review.md 3D-5)
    form_id: str
    target: str
    record_id: str | None = None
    values: dict


class ChatReplyRequest(APIModel):
    trip_id: str | None = None
    workflow_name: str
    message: str
    context: dict | None = None
    # Client-generated id for this send; required. Repeating it replays the
    # original reply instead of running the pipeline twice (review.md 3D-5).
    # Not optional by design: an optional key means the protection is off by
    # default, and the frontend is updated in lockstep anyway.
    request_id: str


class ChatReplyResponse(APIModel):
    trip_id: str
    complete: bool = False
    trip_name: str | None = None
    verify: VerifyResult | None = None
    messages: list[ChatMessageResponse] = []
