"""users.guest_trip_id: the hidden viewer account behind a trip's secret
link (Run stage 31)

The link's secret goes in `trips.view_code`, unused since Run 26.

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-12 20:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("guest_trip_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("guest_trip_id")
