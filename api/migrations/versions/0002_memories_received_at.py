"""memories.received_at: when the server got a memory (Phase 29)

Memories can now be written offline, so `created_at` becomes the phone's
time and the server's own arrival stamp moves to `received_at`. Before this,
`created_at` *was* the server's stamp, so existing rows get it copied.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.db_types

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add it nullable, fill it in, then make it required (SQLite: batch mode).
    with op.batch_alter_table("memories") as batch_op:
        batch_op.add_column(
            sa.Column("received_at", app.db_types.UtcDateTime(timezone=True), nullable=True)
        )
    op.execute("UPDATE memories SET received_at = created_at")
    with op.batch_alter_table("memories") as batch_op:
        batch_op.alter_column(
            "received_at", existing_type=app.db_types.UtcDateTime(timezone=True), nullable=False
        )


def downgrade() -> None:
    with op.batch_alter_table("memories") as batch_op:
        batch_op.drop_column("received_at")
