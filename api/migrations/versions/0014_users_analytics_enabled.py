"""users.analytics_enabled (Phase 76)

Whether the app sends a person's usage to Umami. Existing accounts are
filled the way new ones start: on, except for admins.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-07 12:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("analytics_enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
    )
    op.execute("UPDATE users SET analytics_enabled = 0 WHERE is_superuser = 1")


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("analytics_enabled")
