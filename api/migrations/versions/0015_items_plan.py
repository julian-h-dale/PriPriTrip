"""items.plan: a day's backup plan (Run stage 25)

"a" is a day's plan, "b" its backup plan (plan B). Existing activities are
all plan A.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-08 12:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("items") as batch:
        batch.add_column(sa.Column("plan", sa.String(), server_default="a", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("items") as batch:
        batch.drop_column("plan")
