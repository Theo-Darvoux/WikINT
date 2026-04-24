"""bazaar_async_index

Revision ID: f7a1b2c3d4e5
Revises: dfc717687b05
Create Date: 2026-04-24 14:00:00.000000

Adds a partial index on uploads(sha256) WHERE status = 'clean' to support fast
retroactive quarantine lookups across all clean uploads sharing the same hash.
No column changes — status and sha256 already exist on the uploads table.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7a1b2c3d4e5"
down_revision: str | None = "dfc717687b05"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # Partial index: makes retroactive_quarantine lookups fast when the same
    # sha256 appears across multiple upload rows in 'clean' state.
    op.create_index(
        "ix_uploads_sha256_clean",
        "uploads",
        ["sha256"],
        unique=False,
        postgresql_where="status = 'clean'",
    )


def downgrade() -> None:
    op.drop_index("ix_uploads_sha256_clean", table_name="uploads")
