"""trips.cover_emoji / cover_photo_id: the trips list's card picture
(Run stage 29)

No foreign key on cover_photo_id: SQLite can't add one without rebuilding
`trips`, which its children's foreign keys forbid once there's data.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-12 18:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("cover_emoji", sa.String(), nullable=True))
    op.add_column("trips", sa.Column("cover_photo_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("trips") as batch:
        batch.drop_column("cover_photo_id")
        batch.drop_column("cover_emoji")
