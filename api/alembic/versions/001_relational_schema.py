"""relational schema — split trip items into dedicated table

Revision ID: 001
Revises:
Create Date: 2026-06-03

Handles two cases:
  1. Fresh database — creates both tables from scratch.
  2. Existing database with the legacy trips.data JSONB column — adds scalar
     columns to trips, migrates item rows into trip_items, then drops data.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    trips_exists: bool = conn.execute(
        sa.text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.tables"
            "  WHERE table_schema = 'public' AND table_name = 'trips'"
            ")"
        )
    ).scalar()

    if not trips_exists:
        # ------------------------------------------------------------------
        # Brand-new database — create trips with scalar columns only.
        # ------------------------------------------------------------------
        op.create_table(
            "trips",
            sa.Column("trip_id", sa.String, primary_key=True),
            sa.Column("trip_name", sa.String, nullable=False),
            sa.Column("start_date", sa.String, nullable=False),
            sa.Column("end_date", sa.String, nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("NOW()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("NOW()"),
                nullable=False,
            ),
        )
    else:
        # ------------------------------------------------------------------
        # Existing trips table with legacy JSONB data column.
        # 1. Add new scalar columns (nullable so existing rows don't fail).
        # 2. Back-fill from JSONB.
        # 3. Tighten to NOT NULL.
        # 4. Drop the JSONB column.
        # ------------------------------------------------------------------
        op.add_column("trips", sa.Column("trip_name", sa.String, nullable=True))
        op.add_column("trips", sa.Column("start_date", sa.String, nullable=True))
        op.add_column("trips", sa.Column("end_date", sa.String, nullable=True))
        op.add_column(
            "trips",
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("NOW()"),
                nullable=True,
            ),
        )

        conn.execute(
            sa.text(
                """
                UPDATE trips
                SET
                    trip_name  = data->>'tripName',
                    start_date = data->>'startDate',
                    end_date   = data->>'endDate'
                WHERE data IS NOT NULL
                """
            )
        )

        op.alter_column("trips", "trip_name", nullable=False)
        op.alter_column("trips", "start_date", nullable=False)
        op.alter_column("trips", "end_date", nullable=False)

    # -------------------------------------------------------------------------
    # trip_items table (always created fresh — no prior version existed)
    # -------------------------------------------------------------------------
    op.create_table(
        "trip_items",
        sa.Column("item_id", sa.String, primary_key=True),
        sa.Column(
            "trip_id",
            sa.String,
            sa.ForeignKey("trips.trip_id"),
            nullable=False,
        ),
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
        sa.Column(
            "locations", JSONB, nullable=False, server_default="'[]'::jsonb"
        ),
        sa.Column(
            "completed",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("completed_date_time", sa.String, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # -------------------------------------------------------------------------
    # If we migrated from legacy JSONB, hydrate trip_items from trips.data.items
    # -------------------------------------------------------------------------
    if trips_exists:
        conn.execute(
            sa.text(
                """
                INSERT INTO trip_items (
                    item_id, trip_id, parent_item_id, kind, title,
                    start_date_time, end_date_time, sort_order,
                    confirmation_number, type, subtype, description,
                    image_url, logo_url, locations, completed, completed_date_time
                )
                SELECT
                    item->>'itemId',
                    t.trip_id,
                    NULLIF(item->>'parentItemId', ''),
                    item->>'kind',
                    item->>'title',
                    item->>'startDateTime',
                    item->>'endDateTime',
                    (item->>'sortOrder')::int,
                    NULLIF(item->>'confirmationNumber', ''),
                    NULLIF(item->>'type', ''),
                    NULLIF(item->>'subtype', ''),
                    NULLIF(item->>'description', ''),
                    NULLIF(item->>'imageUrl', ''),
                    NULLIF(item->>'logoUrl', ''),
                    COALESCE(item->'locations', '[]'::jsonb),
                    COALESCE((item->>'completed')::boolean, false),
                    NULLIF(item->>'completedDateTime', '')
                FROM trips t,
                     jsonb_array_elements(
                         COALESCE(t.data->'items', '[]'::jsonb)
                     ) AS item
                WHERE t.data IS NOT NULL
                  AND item->>'itemId' IS NOT NULL
                """
            )
        )

        op.drop_column("trips", "data")


def downgrade() -> None:
    op.drop_table("trip_items")
    op.drop_column("trips", "trip_name")
    op.drop_column("trips", "start_date")
    op.drop_column("trips", "end_date")
    op.drop_column("trips", "created_at")
