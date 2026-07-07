from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Uuid,
    text,
)

from app.database import Base


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
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class TripDayRecord(Base):
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
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class TripPointRecord(Base):
    __tablename__ = "trip_points"

    point_id = Column(Uuid(as_uuid=False), primary_key=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False)
    day_id = Column(Uuid(as_uuid=False), ForeignKey("trip_days.day_id"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    start_date_time = Column(String, nullable=True)
    end_date_time = Column(String, nullable=True)
    confirmation_number = Column(String, nullable=True)
    description = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    completed = Column(Boolean, nullable=False, default=False, server_default="false")
    completed_date_time = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class LocationRecord(Base):
    __tablename__ = "locations"

    location_id = Column(Uuid(as_uuid=False), primary_key=True)
    point_id = Column(Uuid(as_uuid=False), ForeignKey("trip_points.point_id"), nullable=False)
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


class TravelDetailRecord(Base):
    __tablename__ = "travel_details"

    travel_detail_id = Column(Uuid(as_uuid=False), primary_key=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False, index=True)
    point_id = Column(
        Uuid(as_uuid=False),
        ForeignKey("trip_points.point_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    mode = Column(String, nullable=False)
    operator = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    cabin_class = Column(String, nullable=True)


class StayDetailRecord(Base):
    __tablename__ = "stay_details"

    stay_detail_id = Column(Uuid(as_uuid=False), primary_key=True)
    trip_id = Column(Uuid(as_uuid=False), ForeignKey("trips.trip_id"), nullable=False, index=True)
    point_id = Column(
        Uuid(as_uuid=False),
        ForeignKey("trip_points.point_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    stay_type = Column(String, nullable=False)
    check_in_time = Column(String, nullable=True)
    check_out_time = Column(String, nullable=True)
    room_type = Column(String, nullable=True)
