"""add_virus_scan_result

Revision ID: b4c8deec8f6b
Revises: 138afbd354d9
Create Date: 2026-03-14 21:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b4c8deec8f6b"
down_revision: str | None = "138afbd354d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "material_versions",
        sa.Column(
            "virus_scan_result", sa.String(length=20), server_default="pending", nullable=False
        ),
    )
    op.add_column(
        "pull_requests",
        sa.Column(
            "virus_scan_result", sa.String(length=20), server_default="pending", nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_column("pull_requests", "virus_scan_result")
    op.drop_column("material_versions", "virus_scan_result")
