"""packing quantity (Run stage 12)

How many of a packing line to pack. Existing lines are 1.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-06 15:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("packing_items") as batch:
        batch.add_column(sa.Column("quantity", sa.Integer(), server_default="1", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("packing_items") as batch:
        batch.drop_column("quantity")
