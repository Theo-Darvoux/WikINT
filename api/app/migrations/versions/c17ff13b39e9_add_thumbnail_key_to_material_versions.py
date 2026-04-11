"""add thumbnail_key to material_versions

Revision ID: c17ff13b39e9
Revises: e1f2a3b4c5d6
Create Date: 2026-04-11 16:45:11.207145

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c17ff13b39e9'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('material_versions', sa.Column('thumbnail_key', sa.String(length=500), nullable=True))
    op.add_column('uploads', sa.Column('thumbnail_key', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('uploads', 'thumbnail_key')
    op.drop_column('material_versions', 'thumbnail_key')
