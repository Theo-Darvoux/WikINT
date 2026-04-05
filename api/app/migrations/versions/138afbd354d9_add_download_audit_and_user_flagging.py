"""add_download_audit_and_user_flagging

Revision ID: 138afbd354d9
Revises: 016ff5f329ae
Create Date: 2026-03-14 21:24:59.281951

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "138afbd354d9"
down_revision: str | None = "016ff5f329ae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ### Actual changes ###
    op.create_table(
        "download_audit",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_download_audit_created_at"), "download_audit", ["created_at"], unique=False
    )
    op.create_index(
        op.f("ix_download_audit_material_id"), "download_audit", ["material_id"], unique=False
    )
    op.create_index(op.f("ix_download_audit_user_id"), "download_audit", ["user_id"], unique=False)

    op.add_column(
        "users", sa.Column("is_flagged", sa.Boolean(), server_default="false", nullable=False)
    )


def downgrade() -> None:
    op.drop_column("users", "is_flagged")
    op.drop_index(op.f("ix_download_audit_user_id"), table_name="download_audit")
    op.drop_index(op.f("ix_download_audit_material_id"), table_name="download_audit")
    op.drop_index(op.f("ix_download_audit_created_at"), table_name="download_audit")
    op.drop_table("download_audit")
