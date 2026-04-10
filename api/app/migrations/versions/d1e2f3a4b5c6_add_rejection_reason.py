"""add_rejection_reason_to_pull_requests

Revision ID: d1e2f3a4b5c6
Revises: c2d3e4f5a6b7
Create Date: 2026-04-09 00:00:00.000000

- Add rejection_reason TEXT column to pull_requests (nullable)
  Populated when a moderator rejects a contribution; surfaced to the author.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: tuple[str, ...] | str | None = ("c2d3e4f5a6b7", "005")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pull_requests",
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pull_requests", "rejection_reason")
