from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    text,
)

from app.database import Base


class TripRecord(Base):
    __tablename__ = "trips"

    trip_id = Column(String, primary_key=True)
    trip_name = Column(String, nullable=False)
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class TripDayRecord(Base):
    __tablename__ = "trip_days"

    day_id = Column(String, primary_key=True)
    trip_id = Column(String, ForeignKey("trips.trip_id"), nullable=False)
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

    point_id = Column(String, primary_key=True)
    trip_id = Column(String, ForeignKey("trips.trip_id"), nullable=False)
    day_id = Column(String, ForeignKey("trip_days.day_id"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    start_date_time = Column(String, nullable=False)
    end_date_time = Column(String, nullable=False)
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

    location_id = Column(String, primary_key=True)
    point_id = Column(String, ForeignKey("trip_points.point_id"), nullable=False)
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

    point_id = Column(String, ForeignKey("trip_points.point_id"), primary_key=True)
    mode = Column(String, nullable=False)
    operator = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    cabin_class = Column(String, nullable=True)


class StayDetailRecord(Base):
    __tablename__ = "stay_details"

    point_id = Column(String, ForeignKey("trip_points.point_id"), primary_key=True)
    stay_type = Column(String, nullable=False)
    check_in_time = Column(String, nullable=True)
    check_out_time = Column(String, nullable=True)
    room_type = Column(String, nullable=True)
