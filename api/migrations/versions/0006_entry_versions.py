"""entry versions: optimistic concurrency for editors (Phase 41)

Days, activities (items), stays and travels get a version (existing rows
start at 1) and who last changed them and when (null for existing rows: they
were imported, never edited through the API). See app/services/versions.py.

Plain ADD COLUMNs, so no table is rebuilt: rebuilding `days` or `stays`
fails once other rows point at them (SQLite enforces foreign keys here).

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-04 17:35:57.557777
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.db_types

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("days", "items", "stays", "travels")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table, sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False)
        )
        op.add_column(
            table, sa.Column("updated_at", app.db_types.UtcDateTime(timezone=True), nullable=True)
        )
        op.add_column(table, sa.Column("updated_by", sa.Uuid(), nullable=True))


def downgrade() -> None:
    for table in reversed(TABLES):
        # SQLite 3.35+ drops a plain column in place.
        op.drop_column(table, "updated_by")
        op.drop_column(table, "updated_at")
        op.drop_column(table, "version")
