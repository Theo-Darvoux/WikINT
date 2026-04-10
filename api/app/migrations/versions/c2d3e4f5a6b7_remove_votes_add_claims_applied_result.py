"""remove_votes_add_file_claims_applied_result

Revision ID: c2d3e4f5a6b7
Revises: b4c8deec8f6b
Create Date: 2026-04-09 00:00:00.000000

- Drop pr_votes table (voting removed)
- Add pr_file_claims table (replaces Redis lock + JSONB scan for file claiming)
- Add applied_result column to pull_requests (stores enriched ops after approval
  without mutating the original payload)
- Add GIN index on pull_requests.payload (speeds up JSONB queries in /for-item)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c2d3e4f5a6b7"
down_revision: str | None = "b4c8deec8f6b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP VIEW IF EXISTS pull_requests_with_score")
    op.drop_table("pr_votes")

    op.add_column(
        "pull_requests",
        sa.Column("applied_result", postgresql.JSONB(), nullable=True),
    )

    op.create_table(
        "pr_file_claims",
        sa.Column("file_key", sa.Text(), nullable=False),
        sa.Column("pr_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["pr_id"], ["pull_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("file_key"),
    )

    op.create_index(
        "ix_pull_requests_payload_gin",
        "pull_requests",
        ["payload"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_pull_requests_payload_gin", table_name="pull_requests")
    op.drop_table("pr_file_claims")
    op.drop_column("pull_requests", "applied_result")

    op.create_table(
        "pr_votes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("pr_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("value", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["pr_id"], ["pull_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pr_id", "user_id", name="uq_pr_vote_user"),
    )
