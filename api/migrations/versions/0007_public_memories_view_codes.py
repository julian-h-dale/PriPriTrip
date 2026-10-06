"""public memories and view codes (Phase 46)

`memories.is_public`: viewers see only public memories; every existing one
becomes private. `trips.view_code`: the secret code that makes whoever joins
a viewer, made on first ask like the edit code. Plain ADD COLUMNs (no table
rebuild; see 0006).

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-05 12:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memories",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column("trips", sa.Column("view_code", sa.String(), nullable=True))
    op.create_index("uq_trips_view_code", "trips", ["view_code"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("trips", schema=None) as batch_op:
        batch_op.drop_index("uq_trips_view_code")
        batch_op.drop_column("view_code")
    with op.batch_alter_table("memories", schema=None) as batch_op:
        batch_op.drop_column("is_public")
