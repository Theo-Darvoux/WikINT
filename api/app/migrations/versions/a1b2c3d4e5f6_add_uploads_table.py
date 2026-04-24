"""Add uploads lifecycle table

Revision ID: a1b2c3d4e5f6
Revises: 2447499a3966
Create Date: 2026-03-29 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "2447499a3966"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "uploads",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("upload_id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("quarantine_key", sa.Text(), nullable=True),
        sa.Column("final_key", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(200), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column("content_sha256", sa.String(64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("webhook_url", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("upload_id", name="uq_uploads_upload_id"),
    )
    op.create_index("ix_uploads_user_status", "uploads", ["user_id", "status"])
    op.create_index("ix_uploads_sha256", "uploads", ["sha256"])
    op.create_index("ix_uploads_content_sha256", "uploads", ["content_sha256"])
    op.create_index("ix_uploads_upload_id", "uploads", ["upload_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_uploads_upload_id", table_name="uploads")
    op.drop_index("ix_uploads_content_sha256", table_name="uploads")
    op.drop_index("ix_uploads_sha256", table_name="uploads")
    op.drop_index("ix_uploads_user_status", table_name="uploads")
    op.drop_table("uploads")
