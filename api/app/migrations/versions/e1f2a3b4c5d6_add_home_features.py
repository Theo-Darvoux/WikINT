"""add_home_features

Revision ID: e1f2a3b4c5d6
Revises: f3a99f3cd139
Create Date: 2026-04-12 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "f3a99f3cd139"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add views_14d rolling counter to materials
    op.add_column(
        "materials",
        sa.Column("views_14d", sa.Integer(), server_default="0", nullable=False),
    )

    # Create featured_items table
    op.create_table(
        "featured_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("material_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Index for the active-window time range query used by GET /api/home/
    op.create_index(
        "ix_featured_items_window",
        "featured_items",
        ["start_at", "end_at"],
    )

    # Index for priority ordering within active window
    op.create_index(
        "ix_featured_items_priority",
        "featured_items",
        ["priority"],
    )


def downgrade() -> None:
    op.drop_index("ix_featured_items_priority", table_name="featured_items")
    op.drop_index("ix_featured_items_window", table_name="featured_items")
    op.drop_table("featured_items")
    op.drop_column("materials", "views_14d")
