"""Make material directory_id nullable

Revision ID: 2447499a3966
Revises: b4c8deec8f6b
Create Date: 2026-03-27 16:05:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2447499a3966"
down_revision: str | None = "30def97c09a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("materials", "directory_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column("materials", "directory_id", existing_type=sa.UUID(), nullable=False)
