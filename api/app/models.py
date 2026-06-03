from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from app.database import Base


class TripRecord(Base):
    __tablename__ = "trips"

    trip_id = Column(String, primary_key=True)
    trip_name = Column(String, nullable=False)
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class TripItemRecord(Base):
    __tablename__ = "trip_items"

    item_id = Column(String, primary_key=True)
    trip_id = Column(String, ForeignKey("trips.trip_id"), nullable=False)
    parent_item_id = Column(String, nullable=True)
    kind = Column(String, nullable=False)
    title = Column(String, nullable=False)
    start_date_time = Column(String, nullable=False)
    end_date_time = Column(String, nullable=False)
    sort_order = Column(Integer, nullable=False)
    confirmation_number = Column(String, nullable=True)
    type = Column(String, nullable=True)
    subtype = Column(String, nullable=True)
    description = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    locations = Column(JSONB, nullable=False, server_default="'[]'::jsonb")
    completed = Column(Boolean, nullable=False, default=False, server_default="false")
    completed_date_time = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    deleted_at = Column(DateTime(timezone=True), nullable=True)
