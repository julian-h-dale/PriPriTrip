"""SQLAlchemy 2.0 declarative models (review.md 1C-3).

Conventions:
- `Mapped[...]` + `mapped_column(...)`: nullability comes from the annotation
  (`Mapped[str]` = NOT NULL, `Mapped[str | None]` = nullable).
- `updated_at` carries `onupdate=func.now()`, so no call site sets it by hand.
- Every FK column that a query filters on is indexed; Postgres does not index
  FKs automatically. Soft-deleted rows are excluded from the hot-path indexes
  via partial indexes on `NOT is_deleted`.
- Use `active(Model)` in a WHERE clause instead of repeating the two-field
  soft-delete filter.
"""

from datetime import date, datetime
from uuid import UUID

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ColumnElement,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    and_,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SoftDeleteMixin:
    """Reusable soft-delete fields for entities we mark deleted in place."""

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def active(model: type[SoftDeleteMixin]) -> ColumnElement[bool]:
    """WHERE clause selecting rows that are not soft-deleted.

    Both fields must agree; a row is only live when neither is set.
    """
    return and_(model.is_deleted.is_(False), model.deleted_at.is_(None))


def deleted(model: type[SoftDeleteMixin]) -> ColumnElement[bool]:
    """WHERE clause selecting soft-deleted rows (the /deleted listings)."""
    return and_(model.is_deleted.is_(True), model.deleted_at.isnot(None))


class UserRecord(SQLAlchemyBaseUserTableUUID, Base):
    """
    Extends the fastapi-users base table (id, email, hashed_password,
    is_active, is_superuser, is_verified) with an application-level name.
    """

    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String, default="")
    first_name: Mapped[str | None] = mapped_column(String)
    last_name: Mapped[str | None] = mapped_column(String)
    home_location_name: Mapped[str | None] = mapped_column(String)
    home_location_full_address: Mapped[str | None] = mapped_column(String)
    home_location_lat: Mapped[float | None] = mapped_column(Float)
    home_location_lng: Mapped[float | None] = mapped_column(Float)
    home_location_google_place_id: Mapped[str | None] = mapped_column(String)
    home_location_google_maps_uri: Mapped[str | None] = mapped_column(String)
    home_timezone_id: Mapped[str | None] = mapped_column(String)
    phone_number: Mapped[str | None] = mapped_column(String)


class TripRecord(SoftDeleteMixin, Base):
    __tablename__ = "trips"

    trip_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id"), index=True)
    trip_name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="new", server_default="new")
    start_location_name: Mapped[str | None] = mapped_column(String)
    destination_location_name: Mapped[str | None] = mapped_column(String)
    default_timezone_id: Mapped[str | None] = mapped_column(String)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=func.now()
    )

    # Live children only — the soft-delete filter lives in the join, so a
    # caller cannot forget it (review.md 1C-3). viewonly: writes still go
    # through the routers/executor explicitly.
    days: Mapped[list["TripDayRecord"]] = relationship(
        primaryjoin=lambda: and_(
            TripRecord.trip_id == TripDayRecord.trip_id,
            TripDayRecord.is_deleted.is_(False),
            TripDayRecord.deleted_at.is_(None),
        ),
        order_by=lambda: (TripDayRecord.date, TripDayRecord.is_alternate),
        viewonly=True,
    )
    stays: Mapped[list["StayDetailRecord"]] = relationship(
        primaryjoin=lambda: and_(
            TripRecord.trip_id == StayDetailRecord.trip_id,
            StayDetailRecord.is_deleted.is_(False),
            StayDetailRecord.deleted_at.is_(None),
        ),
        viewonly=True,
    )
    travels: Mapped[list["TravelDetailRecord"]] = relationship(
        primaryjoin=lambda: and_(
            TripRecord.trip_id == TravelDetailRecord.trip_id,
            TravelDetailRecord.is_deleted.is_(False),
            TravelDetailRecord.deleted_at.is_(None),
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_trips_user_active", "user_id", postgresql_where=text("NOT is_deleted")),
    )


class TripDayRecord(SoftDeleteMixin, Base):
    __tablename__ = "trip_days"

    day_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    trip_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("trips.trip_id"), index=True
    )
    title: Mapped[str] = mapped_column(String)
    date: Mapped[date] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(String)
    is_alternate: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=func.now()
    )

    points: Mapped[list["TripPointRecord"]] = relationship(
        primaryjoin=lambda: and_(
            TripDayRecord.day_id == TripPointRecord.day_id,
            TripPointRecord.is_deleted.is_(False),
            TripPointRecord.deleted_at.is_(None),
        ),
        order_by=lambda: TripPointRecord.start_local,
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_trip_days_trip_active", "trip_id", postgresql_where=text("NOT is_deleted")),
        # The invariant the app relies on, held by the database rather than by
        # every writer remembering to check: a date has at most one real day.
        # Alternates (a second plan for the same date) are deliberately exempt,
        # and so are soft-deleted rows.
        Index(
            "uq_trip_days_one_primary_per_date",
            "trip_id",
            "date",
            unique=True,
            postgresql_where=text("NOT is_deleted AND NOT is_alternate"),
        ),
    )


class TripPointRecord(SoftDeleteMixin, Base):
    __tablename__ = "trip_points"

    point_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    trip_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("trips.trip_id"), index=True
    )
    day_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("trip_days.day_id"), index=True
    )
    type: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    # A check-in/check-out point links to a stay; a departure/arrival point links
    # to a travel. Activity points reference neither.
    stay_detail_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("stay_details.stay_detail_id", ondelete="SET NULL"),
        index=True,
    )
    travel_detail_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("travel_details.travel_detail_id", ondelete="SET NULL"),
        index=True,
    )
    # Wall clock (what the ticket says) + which clock + the derived instant.
    # There is no separate text copy: the API renders one from start_local.
    start_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    start_tzid: Mapped[str | None] = mapped_column(String)
    start_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    end_tzid: Mapped[str | None] = mapped_column(String)
    end_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmation_number: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String)
    image_url: Mapped[str | None] = mapped_column(String)
    logo_url: Mapped[str | None] = mapped_column(String)
    is_system_created: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    completed_date_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=func.now()
    )

    locations: Mapped[list["LocationRecord"]] = relationship(
        primaryjoin=lambda: TripPointRecord.point_id == LocationRecord.point_id,
        order_by=lambda: LocationRecord.sort_order,
        viewonly=True,
    )
    stay_detail: Mapped["StayDetailRecord | None"] = relationship(
        primaryjoin=lambda: and_(
            TripPointRecord.stay_detail_id == StayDetailRecord.stay_detail_id,
            StayDetailRecord.is_deleted.is_(False),
            StayDetailRecord.deleted_at.is_(None),
        ),
        viewonly=True,
    )
    travel_detail: Mapped["TravelDetailRecord | None"] = relationship(
        primaryjoin=lambda: and_(
            TripPointRecord.travel_detail_id == TravelDetailRecord.travel_detail_id,
            TravelDetailRecord.is_deleted.is_(False),
            TravelDetailRecord.deleted_at.is_(None),
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_trip_points_trip_active", "trip_id", postgresql_where=text("NOT is_deleted")),
        Index("ix_trip_points_day_active", "day_id", postgresql_where=text("NOT is_deleted")),
    )


class LocationRecord(Base):
    __tablename__ = "locations"

    location_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    # Exactly one owner FK is set (enforced by the check constraint below).
    point_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("trip_points.point_id", ondelete="CASCADE"),
        index=True,
    )
    stay_detail_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("stay_details.stay_detail_id", ondelete="CASCADE"),
        index=True,
    )
    travel_detail_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("travel_details.travel_detail_id", ondelete="CASCADE"),
        index=True,
    )
    role: Mapped[str] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    name: Mapped[str] = mapped_column(String)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    full_address: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String)
    link: Mapped[str | None] = mapped_column(String)
    google_place_id: Mapped[str | None] = mapped_column(String)
    google_maps_uri: Mapped[str | None] = mapped_column(String)
    timezone_id: Mapped[str | None] = mapped_column(String)

    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(point_id, stay_detail_id, travel_detail_id) = 1",
            name="location_single_owner",
        ),
    )


class TravelDetailRecord(SoftDeleteMixin, Base):
    __tablename__ = "travel_details"

    travel_detail_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    trip_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("trips.trip_id"), index=True
    )
    name: Mapped[str | None] = mapped_column(String)
    mode: Mapped[str] = mapped_column(String)
    operator: Mapped[str | None] = mapped_column(String)
    vehicle_number: Mapped[str | None] = mapped_column(String)
    cabin_class: Mapped[str | None] = mapped_column(String)
    departure_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    departure_tzid: Mapped[str | None] = mapped_column(String)
    departure_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    arrival_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    arrival_tzid: Mapped[str | None] = mapped_column(String)
    arrival_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmation_number: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=func.now()
    )

    locations: Mapped[list["LocationRecord"]] = relationship(
        primaryjoin=lambda: TravelDetailRecord.travel_detail_id == LocationRecord.travel_detail_id,
        order_by=lambda: LocationRecord.sort_order,
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_travel_details_trip_active", "trip_id", postgresql_where=text("NOT is_deleted")),
    )


class StayDetailRecord(SoftDeleteMixin, Base):
    __tablename__ = "stay_details"

    stay_detail_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    trip_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("trips.trip_id"), index=True
    )
    name: Mapped[str | None] = mapped_column(String)
    stay_type: Mapped[str] = mapped_column(String)
    check_in_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    check_in_tzid: Mapped[str | None] = mapped_column(String)
    check_in_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    check_out_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    check_out_tzid: Mapped[str | None] = mapped_column(String)
    check_out_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    room_type: Mapped[str | None] = mapped_column(String)
    confirmation_number: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=func.now()
    )

    locations: Mapped[list["LocationRecord"]] = relationship(
        primaryjoin=lambda: StayDetailRecord.stay_detail_id == LocationRecord.stay_detail_id,
        order_by=lambda: LocationRecord.sort_order,
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_stay_details_trip_active", "trip_id", postgresql_where=text("NOT is_deleted")),
    )


class AIDocumentRecord(Base):
    __tablename__ = "ai_documents"

    document_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id"), index=True)
    trip_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("trips.trip_id"), index=True
    )
    filename: Mapped[str] = mapped_column(String)
    document_type: Mapped[str] = mapped_column(String, default="detail", server_default="detail")
    workflow_mode: Mapped[str] = mapped_column(
        String, default="detail_import", server_default="detail_import"
    )
    content_hash: Mapped[str] = mapped_column(String, index=True)
    body_contents: Mapped[str] = mapped_column(String)
    extracted_payload: Mapped[str | None] = mapped_column(String)
    trip_import_payload: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "trip_id",
            "content_hash",
            "document_type",
            name="uq_ai_documents_user_trip_hash_type",
        ),
        CheckConstraint(
            "filename <> ''",
            name="ai_document_filename_nonempty",
        ),
        CheckConstraint(
            "document_type IN ('itinerary', 'detail')",
            name="ai_document_type_valid",
        ),
        CheckConstraint(
            "workflow_mode IN ('itinerary_import', 'detail_import')",
            name="ai_document_workflow_mode_valid",
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


class ChatMessageRecord(Base):
    __tablename__ = "chat_messages"

    message_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=False), ForeignKey("users.id"), index=True)
    trip_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("trips.trip_id"), index=True
    )
    workflow_name: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(String)
    structure_content: Mapped[str | None] = mapped_column(String)
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Idempotency (review.md 3D-5). The client stamps each send with a request
    # id; both rows of the turn carry it. The unique constraint below is what
    # actually blocks a double-send — the second insert waits on the first and
    # then fails, instead of running the whole LLM pipeline again.
    request_id: Mapped[str | None] = mapped_column(String)
    # The bot row stores the exact ChatReplyResponse it produced, so a repeat
    # of the same request replays it verbatim rather than recomputing.
    reply_payload: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()")
    )

    __table_args__ = (
        CheckConstraint("message <> ''", name="chat_message_nonempty"),
        # Every chat read filters by this triple, ordered by created_at.
        Index("ix_chat_messages_trip_workflow", "trip_id", "user_id", "workflow_name", "created_at"),
        # NULL request_id repeats freely (Postgres treats NULLs as distinct),
        # so clients that don't send one are unaffected.
        UniqueConstraint("user_id", "request_id", "is_bot", name="uq_chat_messages_user_request"),
    )
