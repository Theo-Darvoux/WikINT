"""Add cas_sha256 column to material_versions for CAS V2 ref counting

Revision ID: 005
Revises: 004
Create Date: 2026-04-08

- Add cas_sha256 (VARCHAR(64), nullable) to material_versions
  Stores the original file SHA-256 used to compute the HMAC CAS key.
  Required for decrementing CAS ref counts on version deletion.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision = "005"
down_revision = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "material_versions",
        sa.Column("cas_sha256", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("material_versions", "cas_sha256")
