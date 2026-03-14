"""fix summary_types containing null

Revision ID: 016ff5f329ae
Revises: 002
Create Date: 2026-03-13 01:31:46.709512

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '016ff5f329ae'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE pull_requests
        SET summary_types = (
            SELECT COALESCE(
                (SELECT jsonb_agg(DISTINCT elem->>'op') FROM jsonb_array_elements(payload) AS elem WHERE elem->>'op' IS NOT NULL),
                (SELECT jsonb_agg(DISTINCT elem->>'pr_type') FROM jsonb_array_elements(payload) AS elem WHERE elem->>'pr_type' IS NOT NULL),
                '[]'::jsonb
            )
        )
        WHERE summary_types @> '[null]';
    """)


def downgrade() -> None:
    pass
