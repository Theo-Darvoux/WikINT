"""Pipeline resilience: checkpointing columns + dead letter queue

Revision ID: 003
Revises: a1b2c3d4e5f6
Create Date: 2026-04-01

- Add pipeline_stage, cas_key, cas_ref_count to uploads table
- Create dead_letter_jobs table
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "003"
down_revision = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # -- Add pipeline resilience columns to uploads --
    op.add_column(
        "uploads",
        sa.Column("pipeline_stage", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "uploads",
        sa.Column("cas_key", sa.String(128), nullable=True),
    )
    op.add_column(
        "uploads",
        sa.Column("cas_ref_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_uploads_cas_key", "uploads", ["cas_key"])

    # -- Create dead_letter_jobs table --
    op.create_table(
        "dead_letter_jobs",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("job_name", sa.String(100), nullable=False),
        sa.Column("upload_id", sa.String(64), nullable=False),
        sa.Column("payload", JSONB(), nullable=False, server_default="{}"),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dead_letter_jobs_upload_id", "dead_letter_jobs", ["upload_id"])


def downgrade() -> None:
    op.drop_index("ix_dead_letter_jobs_upload_id", table_name="dead_letter_jobs")
    op.drop_table("dead_letter_jobs")
    op.drop_index("ix_uploads_cas_key", table_name="uploads")
    op.drop_column("uploads", "cas_ref_count")
    op.drop_column("uploads", "cas_key")
    op.drop_column("uploads", "pipeline_stage")
