"""memories.place_name / place_area: where a memory was written, in words
(Run stage 26)

Looked up on the server after a memory with a location is saved. Existing
memories get them from `make backfill-places`.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-08 18:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("memories") as batch:
        batch.add_column(sa.Column("place_name", sa.String(), nullable=True))
        batch.add_column(sa.Column("place_area", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("memories") as batch:
        batch.drop_column("place_area")
        batch.drop_column("place_name")
