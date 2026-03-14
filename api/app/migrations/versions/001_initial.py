"""initial migration

Revision ID: 001
Revises:
Create Date: 2026-02-20

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ENUM types
    user_role = postgresql.ENUM(
        "student", "member", "bureau", "vieux", name="userrole", create_type=False
    )
    directory_type = postgresql.ENUM("module", "folder", name="directorytype", create_type=False)
    pr_type = postgresql.ENUM(
        "create_material",
        "edit_material",
        "delete_material",
        "create_directory",
        "edit_directory",
        "delete_directory",
        "move_item",
        name="prtype",
        create_type=False,
    )
    pr_status = postgresql.ENUM("open", "approved", "rejected", name="prstatus", create_type=False)
    flag_status = postgresql.ENUM(
        "open", "reviewing", "resolved", "dismissed", name="flagstatus", create_type=False
    )

    user_role.create(op.get_bind(), checkfirst=True)
    directory_type.create(op.get_bind(), checkfirst=True)
    pr_type.create(op.get_bind(), checkfirst=True)
    pr_status.create(op.get_bind(), checkfirst=True)
    flag_status.create(op.get_bind(), checkfirst=True)

    # Users
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=True),
        sa.Column("avatar_url", sa.String(500), nullable=True),
        sa.Column("role", user_role, server_default="student", nullable=False),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("academic_year", sa.String(10), nullable=True),
        sa.Column("gdpr_consent", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("gdpr_consent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("onboarded", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("idx_users_deleted_at", "users", ["deleted_at"])

    # Directories
    op.create_table(
        "directories",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("type", directory_type, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["parent_id"], ["directories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("parent_id", "slug", name="uq_directory_parent_slug"),
    )
    op.create_index("idx_directories_parent", "directories", ["parent_id"])
    op.create_index("idx_directories_slug", "directories", ["slug"])
    op.create_index("idx_directories_type", "directories", ["type"])

    # Tags
    op.create_table(
        "tags",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("idx_tags_name", "tags", ["name"])

    # Directory tags
    op.create_table(
        "directory_tags",
        sa.Column("directory_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("directory_id", "tag_id"),
        sa.ForeignKeyConstraint(["directory_id"], ["directories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
    )

    # Pull requests
    op.create_table(
        "pull_requests",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("type", pr_type, nullable=False),
        sa.Column("status", pr_status, server_default="open", nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_pull_requests_status", "pull_requests", ["status"])
    op.create_index("idx_pull_requests_author", "pull_requests", ["author_id"])
    op.create_index("idx_pull_requests_type_status", "pull_requests", ["type", "status"])

    # Materials
    op.create_table(
        "materials",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("directory_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("slug", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("current_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("parent_material_id", sa.Uuid(), nullable=True),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("download_count", sa.Integer(), server_default="0", nullable=False),
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
        sa.ForeignKeyConstraint(["directory_id"], ["directories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("directory_id", "slug", name="uq_material_directory_slug"),
    )
    op.create_index("idx_materials_directory", "materials", ["directory_id"])
    op.create_index("idx_materials_type", "materials", ["type"])
    op.create_index("idx_materials_author", "materials", ["author_id"])
    op.create_index("idx_materials_parent_material", "materials", ["parent_material_id"])
    op.create_index("idx_materials_slug", "materials", ["slug"])

    # Material tags
    op.create_table(
        "material_tags",
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("material_id", "tag_id"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
    )

    # Material versions
    op.create_table(
        "material_versions",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("file_key", sa.String(500), nullable=True),
        sa.Column("file_name", sa.String(300), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("file_mime_type", sa.String(100), nullable=True),
        sa.Column("diff_summary", sa.Text(), nullable=True),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("pr_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["pr_id"], ["pull_requests.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("material_id", "version_number", name="uq_material_version"),
    )
    op.create_index("idx_material_versions_material", "material_versions", ["material_id"])
    op.create_index("idx_material_versions_author", "material_versions", ["author_id"])

    # Comments
    op.create_table(
        "comments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_comments_target", "comments", ["target_type", "target_id", "created_at"])

    # PR votes
    op.create_table(
        "pr_votes",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("pr_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("value", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["pr_id"], ["pull_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("pr_id", "user_id", name="uq_pr_vote_user"),
        sa.CheckConstraint("value IN (-1, 1)", name="ck_pr_vote_value"),
    )
    op.create_index("idx_pr_votes_pr", "pr_votes", ["pr_id"])

    # PR comments
    op.create_table(
        "pr_comments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("pr_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["pr_id"], ["pull_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_id"], ["pr_comments.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_pr_comments_pr", "pr_comments", ["pr_id"])
    op.create_index("idx_pr_comments_parent", "pr_comments", ["parent_id"])

    # Annotations
    op.create_table(
        "annotations",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=True),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("selection_text", sa.Text(), nullable=True),
        sa.Column("position_data", postgresql.JSONB(), nullable=True),
        sa.Column("thread_id", sa.Uuid(), nullable=True),
        sa.Column("reply_to_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["material_versions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["thread_id"], ["annotations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reply_to_id"], ["annotations.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_annotations_material", "annotations", ["material_id"])
    op.create_index("idx_annotations_thread", "annotations", ["thread_id"])
    op.create_index("idx_annotations_version", "annotations", ["version_id"])
    op.create_index("idx_annotations_author", "annotations", ["author_id"])

    # View history
    op.create_table(
        "view_history",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column(
            "viewed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "material_id", name="uq_view_history_user_material"),
    )
    op.create_index("idx_view_history_user", "view_history", ["user_id", "viewed_at"])

    # Flags
    op.create_table(
        "flags",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("reporter_id", sa.Uuid(), nullable=True),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", flag_status, server_default="open", nullable=False),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "reporter_id", "target_type", "target_id", name="uq_flag_reporter_target"
        ),
    )
    op.create_index("idx_flags_status", "flags", ["status"])
    op.create_index("idx_flags_target", "flags", ["target_type", "target_id"])

    # Notifications
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("link", sa.String(500), nullable=True),
        sa.Column("read", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "idx_notifications_user_unread", "notifications", ["user_id", "read", "created_at"]
    )

    # SQL Views
    op.execute("""
        CREATE VIEW pull_requests_with_score AS
        SELECT pr.*,
               COALESCE((SELECT SUM(value) FROM pr_votes WHERE pr_id = pr.id), 0) AS vote_score,
               (SELECT COUNT(*) FROM pr_votes WHERE pr_id = pr.id AND value = 1)  AS upvotes,
               (SELECT COUNT(*) FROM pr_votes WHERE pr_id = pr.id AND value = -1) AS downvotes
        FROM pull_requests pr
    """)

    op.execute("""
        CREATE VIEW user_stats AS
        SELECT u.id AS user_id,
               (SELECT COUNT(*) FROM pull_requests WHERE author_id = u.id AND status = 'approved') AS prs_approved,
               (SELECT COUNT(*) FROM pull_requests WHERE author_id = u.id)                          AS prs_total,
               (SELECT COUNT(*) FROM annotations WHERE author_id = u.id)                            AS annotations_count,
               (SELECT COUNT(*) FROM comments WHERE author_id = u.id)                               AS comments_count,
               (SELECT COUNT(*) FROM pull_requests WHERE author_id = u.id AND status = 'open')      AS open_pr_count
        FROM users u
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS user_stats")
    op.execute("DROP VIEW IF EXISTS pull_requests_with_score")

    op.drop_table("notifications")
    op.drop_table("flags")
    op.drop_table("view_history")
    op.drop_table("annotations")
    op.drop_table("pr_comments")
    op.drop_table("pr_votes")
    op.drop_table("comments")
    op.drop_table("material_versions")
    op.drop_table("material_tags")
    op.drop_table("materials")
    op.drop_table("pull_requests")
    op.drop_table("directory_tags")
    op.drop_table("tags")
    op.drop_table("directories")
    op.drop_table("users")

    op.execute("DROP TYPE IF EXISTS flagstatus")
    op.execute("DROP TYPE IF EXISTS prstatus")
    op.execute("DROP TYPE IF EXISTS prtype")
    op.execute("DROP TYPE IF EXISTS directorytype")
    op.execute("DROP TYPE IF EXISTS userrole")
