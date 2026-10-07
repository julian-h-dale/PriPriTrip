"""trip documents (Phase 60)

Files kept with a trip as a hard-copy fallback (the files themselves are in
DOCUMENT_DIR). Not versioned: uploading again replaces the file.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-06 11:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import fastapi_users_db_sqlalchemy
import sqlalchemy as sa
from alembic import op

import app.db_types

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "trip_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("trip_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", fastapi_users_db_sqlalchemy.generics.GUID(), nullable=False),
        sa.Column("created_at", app.db_types.UtcDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.db_types.UtcDateTime(timezone=True), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", app.db_types.UtcDateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("trip_documents") as batch:
        batch.create_index("ix_trip_documents_trip_id", ["trip_id"])
        batch.create_index("ix_trip_documents_uploaded_by", ["uploaded_by"])
        batch.create_index("ix_trip_documents_is_deleted", ["is_deleted"])


def downgrade() -> None:
    op.drop_table("trip_documents")
