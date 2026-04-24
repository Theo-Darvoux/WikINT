"""Optimistic locking: version_lock column on material_versions

Revision ID: 004
Revises: 003
Create Date: 2026-04-02

- Add version_lock (Integer, default 0) to material_versions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision = "004"
down_revision = "003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "material_versions",
        sa.Column(
            "version_lock",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("material_versions", "version_lock")
