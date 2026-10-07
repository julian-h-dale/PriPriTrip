"""packing items (Phase 58)

Each person's own packing list per trip. A list is a category; no list table.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-06 09:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import fastapi_users_db_sqlalchemy
import sqlalchemy as sa
from alembic import op

import app.db_types

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "packing_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("trip_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", fastapi_users_db_sqlalchemy.generics.GUID(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("checked", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", app.db_types.UtcDateTime(timezone=True), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", app.db_types.UtcDateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("packing_items") as batch:
        batch.create_index("ix_packing_items_trip_id", ["trip_id"])
        batch.create_index("ix_packing_items_user_id", ["user_id"])
        batch.create_index("ix_packing_items_is_deleted", ["is_deleted"])


def downgrade() -> None:
    op.drop_table("packing_items")
