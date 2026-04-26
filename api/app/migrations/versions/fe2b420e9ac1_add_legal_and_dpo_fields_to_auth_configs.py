"""add legal and dpo fields to auth_configs

Revision ID: fe2b420e9ac1
Revises: f7a1b2c3d4e5
Create Date: 2026-04-25 15:15:47.536075

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'fe2b420e9ac1'
down_revision: Union[str, None] = 'f7a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('auth_configs', sa.Column('legal_name', sa.String(length=255), nullable=True))
    op.add_column('auth_configs', sa.Column('legal_address', sa.Text(), nullable=True))
    op.add_column('auth_configs', sa.Column('contact_email', sa.String(length=255), nullable=True))
    op.add_column('auth_configs', sa.Column('dpo_email', sa.String(length=255), nullable=True))
    op.add_column('auth_configs', sa.Column('dpo_address', sa.Text(), nullable=True))
    op.add_column('auth_configs', sa.Column('data_transfers', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('auth_configs', 'data_transfers')
    op.drop_column('auth_configs', 'dpo_address')
    op.drop_column('auth_configs', 'dpo_email')
    op.drop_column('auth_configs', 'contact_email')
    op.drop_column('auth_configs', 'legal_address')
    op.drop_column('auth_configs', 'legal_name')
