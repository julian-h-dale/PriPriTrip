"""days and points schema — replace trip_items with trip_days, trip_points, locations, and detail tables

Revision ID: 002
Revises: 001
Create Date: 2026-06-03

Migrates the flat trip_items table (groups + legs) into:
  - trip_days   (was: trip_items where kind = 'group')
  - trip_points (was: trip_items where kind = 'leg')
  - locations   (was: JSONB array on each leg)
  - travel_details / stay_details (new type-specific extension tables, no back-fill)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create new tables ─────────────────────────────────────────────────

    op.create_table(
        "trip_days",
        sa.Column("day_id", sa.String, primary_key=True),
        sa.Column("trip_id", sa.String, sa.ForeignKey("trips.trip_id"), nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("date", sa.String, nullable=False),
        sa.Column("description", sa.String, nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("completed", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "trip_points",
        sa.Column("point_id", sa.String, primary_key=True),
        sa.Column("trip_id", sa.String, sa.ForeignKey("trips.trip_id"), nullable=False),
        sa.Column("day_id", sa.String, sa.ForeignKey("trip_days.day_id"), nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("start_date_time", sa.String, nullable=False),
        sa.Column("end_date_time", sa.String, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("confirmation_number", sa.String, nullable=True),
        sa.Column("description", sa.String, nullable=True),
        sa.Column("image_url", sa.String, nullable=True),
        sa.Column("logo_url", sa.String, nullable=True),
        sa.Column("completed", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("completed_date_time", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "locations",
        sa.Column("location_id", sa.String, primary_key=True),
        sa.Column("point_id", sa.String, sa.ForeignKey("trip_points.point_id"), nullable=False),
        sa.Column("role", sa.String, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("lat", sa.Float, nullable=True),
        sa.Column("lng", sa.Float, nullable=True),
        sa.Column("full_address", sa.String, nullable=True),
        sa.Column("description", sa.String, nullable=True),
        sa.Column("link", sa.String, nullable=True),
        sa.Column("google_place_id", sa.String, nullable=True),
        sa.Column("google_maps_uri", sa.String, nullable=True),
    )

    op.create_table(
        "travel_details",
        sa.Column("point_id", sa.String, sa.ForeignKey("trip_points.point_id"), primary_key=True),
        sa.Column("mode", sa.String, nullable=False),
        sa.Column("operator", sa.String, nullable=True),
        sa.Column("vehicle_number", sa.String, nullable=True),
        sa.Column("cabin_class", sa.String, nullable=True),
    )

    op.create_table(
        "stay_details",
        sa.Column("point_id", sa.String, sa.ForeignKey("trip_points.point_id"), primary_key=True),
        sa.Column("stay_type", sa.String, nullable=False),
        sa.Column("check_in_time", sa.String, nullable=True),
        sa.Column("check_out_time", sa.String, nullable=True),
        sa.Column("room_type", sa.String, nullable=True),
    )

    # ── 2. Back-fill from trip_items (if it exists and has rows) ─────────────

    conn = op.get_bind()

    trip_items_exists: bool = conn.execute(
        sa.text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.tables"
            "  WHERE table_schema = 'public' AND table_name = 'trip_items'"
            ")"
        )
    ).scalar()

    if trip_items_exists:
        # trip_days ← groups
        conn.execute(
            sa.text(
                """
                INSERT INTO trip_days
                    (day_id, trip_id, title, date, description, sort_order,
                     completed, created_at, updated_at, deleted_at)
                SELECT
                    item_id,
                    trip_id,
                    title,
                    LEFT(start_date_time, 10),
                    description,
                    sort_order,
                    completed,
                    created_at,
                    updated_at,
                    deleted_at
                FROM trip_items
                WHERE kind = 'group'
                """
            )
        )

        # trip_points ← legs that reference a valid group
        conn.execute(
            sa.text(
                """
                INSERT INTO trip_points
                    (point_id, trip_id, day_id, type, title,
                     start_date_time, end_date_time, sort_order,
                     confirmation_number, description, image_url, logo_url,
                     completed, completed_date_time, created_at, updated_at, deleted_at)
                SELECT
                    item_id,
                    trip_id,
                    parent_item_id,
                    COALESCE(type, 'activity'),
                    title,
                    start_date_time,
                    end_date_time,
                    sort_order,
                    confirmation_number,
                    description,
                    image_url,
                    logo_url,
                    completed,
                    completed_date_time,
                    created_at,
                    updated_at,
                    deleted_at
                FROM trip_items
                WHERE kind = 'leg'
                  AND parent_item_id IS NOT NULL
                  AND parent_item_id IN (
                      SELECT item_id FROM trip_items WHERE kind = 'group'
                  )
                """
            )
        )

        # locations ← expand JSONB arrays from migrated legs
        # Old location structure: { name, fullAddress, description, link,
        #   googlePlaceId, googleMapsUri, location: { latitude, longitude } }
        conn.execute(
            sa.text(
                """
                INSERT INTO locations
                    (location_id, point_id, role, sort_order, name,
                     lat, lng, full_address, description, link,
                     google_place_id, google_maps_uri)
                SELECT
                    gen_random_uuid()::text,
                    ti.item_id,
                    'venue',
                    (locs.idx - 1)::int,
                    locs.loc->>'name',
                    (locs.loc->'location'->>'latitude')::float,
                    (locs.loc->'location'->>'longitude')::float,
                    locs.loc->>'fullAddress',
                    locs.loc->>'description',
                    locs.loc->>'link',
                    locs.loc->>'googlePlaceId',
                    locs.loc->>'googleMapsUri'
                FROM trip_items ti
                CROSS JOIN LATERAL
                    jsonb_array_elements(ti.locations) WITH ORDINALITY AS locs(loc, idx)
                WHERE ti.kind = 'leg'
                  AND ti.parent_item_id IS NOT NULL
                  AND ti.parent_item_id IN (
                      SELECT item_id FROM trip_items WHERE kind = 'group'
                  )
                  AND jsonb_array_length(ti.locations) > 0
                """
            )
        )

        op.drop_table("trip_items")


def downgrade() -> None:
    from sqlalchemy.dialects.postgresql import JSONB

    op.create_table(
        "trip_items",
        sa.Column("item_id", sa.String, primary_key=True),
        sa.Column("trip_id", sa.String, sa.ForeignKey("trips.trip_id"), nullable=False),
        sa.Column("parent_item_id", sa.String, nullable=True),
        sa.Column("kind", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("start_date_time", sa.String, nullable=False),
        sa.Column("end_date_time", sa.String, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("confirmation_number", sa.String, nullable=True),
        sa.Column("type", sa.String, nullable=True),
        sa.Column("subtype", sa.String, nullable=True),
        sa.Column("description", sa.String, nullable=True),
        sa.Column("image_url", sa.String, nullable=True),
        sa.Column("logo_url", sa.String, nullable=True),
        sa.Column("locations", JSONB, nullable=False, server_default="'[]'::jsonb"),
        sa.Column("completed", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("completed_date_time", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    conn = op.get_bind()

    # Restore groups
    conn.execute(
        sa.text(
            """
            INSERT INTO trip_items
                (item_id, trip_id, parent_item_id, kind, title,
                 start_date_time, end_date_time, sort_order,
                 description, completed, created_at, updated_at, deleted_at)
            SELECT
                day_id, trip_id, NULL, 'group', title,
                date || 'T00:00:00Z', date || 'T23:59:59Z', sort_order,
                description, completed, created_at, updated_at, deleted_at
            FROM trip_days
            """
        )
    )

    # Restore legs (locations left as empty JSONB array)
    conn.execute(
        sa.text(
            """
            INSERT INTO trip_items
                (item_id, trip_id, parent_item_id, kind, type, title,
                 start_date_time, end_date_time, sort_order,
                 confirmation_number, description, image_url, logo_url,
                 completed, completed_date_time, created_at, updated_at, deleted_at)
            SELECT
                point_id, trip_id, day_id, 'leg', type, title,
                start_date_time, end_date_time, sort_order,
                confirmation_number, description, image_url, logo_url,
                completed, completed_date_time, created_at, updated_at, deleted_at
            FROM trip_points
            """
        )
    )

    op.drop_table("stay_details")
    op.drop_table("travel_details")
    op.drop_table("locations")
    op.drop_table("trip_points")
    op.drop_table("trip_days")
