from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)

from app.database import Base


class SoftDeleteMixin:
    """Reusable soft-delete fields for entities we mark deleted in place."""

    is_deleted = Column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class UserRecord(SQLAlchemyBaseUserTableUUID, Base):
    """
    Extends the fastapi-users base table (id, email, hashed_password,
    is_active, is_superuser, is_verified) with an application-level name.
    """

    __tablename__ = "users"

    name = Column(String, nullable=False, default="")


class TripRecord(Base):
    __tablename__ = "trips"

    trip_id = Column(Uuid(as_uuid=False), primary_key=True)
    user_id = Column(Uuid(as_uuid=False), ForeignKey("users.id"), nullable=False)
    trip_name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="draft", server_default="draft")
    default_timezone_id = Column(String, nullable=True)
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class TripDayRecord(SoftDeleteMixin, Base):
    __tablename__ = "trip_days"

    day_id = Column(Uuid(as_uuid=False), primary_key=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False)
    title = Column(String, nullable=False)
    date = Column(String, nullable=False)
    description = Column(String, nullable=True)
    is_alternate = Column(Boolean, nullable=False, default=False, server_default="false")
    completed = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class TripPointRecord(SoftDeleteMixin, Base):
    __tablename__ = "trip_points"

    point_id = Column(Uuid(as_uuid=False), primary_key=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False)
    day_id = Column(Uuid(as_uuid=False), ForeignKey("trip_days.day_id"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    # A check-in/check-out point links to a stay; a departure/arrival point links
    # to a travel. Activity points reference neither.
    stay_detail_id = Column(
        Uuid(as_uuid=False),
        ForeignKey("stay_details.stay_detail_id", ondelete="SET NULL"),
        nullable=True,
    )
    travel_detail_id = Column(
        Uuid(as_uuid=False),
        ForeignKey("travel_details.travel_detail_id", ondelete="SET NULL"),
        nullable=True,
    )
    # Wall-clock source of truth and derived UTC instant.
    start_local = Column(DateTime(timezone=False), nullable=True)
    start_tzid = Column(String, nullable=True)
    start_utc = Column(DateTime(timezone=True), nullable=True)
    end_local = Column(DateTime(timezone=False), nullable=True)
    end_tzid = Column(String, nullable=True)
    end_utc = Column(DateTime(timezone=True), nullable=True)
    start_date_time = Column(String, nullable=True)
    end_date_time = Column(String, nullable=True)
    confirmation_number = Column(String, nullable=True)
    description = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    is_system_created = Column(Boolean, nullable=False, default=False, server_default="false")
    completed = Column(Boolean, nullable=False, default=False, server_default="false")
    completed_date_time = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class LocationRecord(Base):
    __tablename__ = "locations"

    location_id = Column(Uuid(as_uuid=False), primary_key=True)
    # Exactly one owner FK is set (enforced by the check constraint below).
    point_id = Column(
        Uuid(as_uuid=False),
        ForeignKey("trip_points.point_id", ondelete="CASCADE"),
        nullable=True,
    )
    stay_detail_id = Column(
        Uuid(as_uuid=False),
        ForeignKey("stay_details.stay_detail_id", ondelete="CASCADE"),
        nullable=True,
    )
    travel_detail_id = Column(
        Uuid(as_uuid=False),
        ForeignKey("travel_details.travel_detail_id", ondelete="CASCADE"),
        nullable=True,
    )
    role = Column(String, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    name = Column(String, nullable=False)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    full_address = Column(String, nullable=True)
    description = Column(String, nullable=True)
    link = Column(String, nullable=True)
    google_place_id = Column(String, nullable=True)
    google_maps_uri = Column(String, nullable=True)
    timezone_id = Column(String, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(point_id, stay_detail_id, travel_detail_id) = 1",
            name="location_single_owner",
        ),
    )


class TravelDetailRecord(SoftDeleteMixin, Base):
    __tablename__ = "travel_details"

    travel_detail_id = Column(Uuid(as_uuid=False), primary_key=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False, index=True)
    name = Column(String, nullable=True)
    mode = Column(String, nullable=False)
    operator = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    cabin_class = Column(String, nullable=True)
    departure_local = Column(DateTime(timezone=False), nullable=True)
    departure_tzid = Column(String, nullable=True)
    departure_utc = Column(DateTime(timezone=True), nullable=True)
    arrival_local = Column(DateTime(timezone=False), nullable=True)
    arrival_tzid = Column(String, nullable=True)
    arrival_utc = Column(DateTime(timezone=True), nullable=True)
    departure_date_time = Column(String, nullable=True)
    arrival_date_time = Column(String, nullable=True)
    confirmation_number = Column(String, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class StayDetailRecord(SoftDeleteMixin, Base):
    __tablename__ = "stay_details"

    stay_detail_id = Column(Uuid(as_uuid=False), primary_key=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False, index=True)
    name = Column(String, nullable=True)
    stay_type = Column(String, nullable=False)
    check_in_local = Column(DateTime(timezone=False), nullable=True)
    check_in_tzid = Column(String, nullable=True)
    check_in_utc = Column(DateTime(timezone=True), nullable=True)
    check_out_local = Column(DateTime(timezone=False), nullable=True)
    check_out_tzid = Column(String, nullable=True)
    check_out_utc = Column(DateTime(timezone=True), nullable=True)
    check_in = Column(String, nullable=True)
    check_out = Column(String, nullable=True)
    room_type = Column(String, nullable=True)
    confirmation_number = Column(String, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class AIDocumentRecord(Base):
    __tablename__ = "ai_documents"

    document_id = Column(Uuid(as_uuid=False), primary_key=True)
    user_id = Column(Uuid(as_uuid=False), ForeignKey("users.id"), nullable=False, index=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    content_hash = Column(String, nullable=False, index=True)
    body_contents = Column(String, nullable=False)
    extracted_payload = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "trip_id",
            "content_hash",
            name="uq_ai_documents_user_trip_hash",
        ),
        CheckConstraint(
            "filename <> ''",
            name="ai_document_filename_nonempty",
        ),
        CheckConstraint(
            "content_hash <> ''",
            name="ai_document_hash_nonempty",
        ),
        CheckConstraint(
            "body_contents <> ''",
            name="ai_document_body_nonempty",
        ),
    )
