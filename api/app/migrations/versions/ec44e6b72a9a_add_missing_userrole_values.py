"""add_missing_userrole_values

Revision ID: ec44e6b72a9a
Revises: 0848234829d9
Create Date: 2026-04-10 14:25:38.231264

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'ec44e6b72a9a'
down_revision: Union[str, None] = '0848234829d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'moderator'")
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'bureau'")
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'vieux'")


def downgrade() -> None:
    pass
