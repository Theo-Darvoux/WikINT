"""batch_pr_upgrade

Revision ID: 002
Revises: 001
Create Date: 2026-03-11

- Convert pull_requests.payload from single dict to array of dicts
- Change type column from PRType enum to varchar 'batch'
"""
import sqlalchemy as sa
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0. Drop views that depend on pull_requests columns (they use pr.*)
    op.execute("DROP VIEW IF EXISTS pull_requests_with_score")

    # 1. Wrap existing single-object payloads into arrays
    op.execute("""
        UPDATE pull_requests
        SET payload = jsonb_build_array(payload)
        WHERE jsonb_typeof(payload) = 'object'
    """)

    # 2. Change type column from enum to varchar
    #    First add a temporary varchar column, copy data, drop old, rename
    op.add_column("pull_requests", sa.Column("type_new", sa.String(50), nullable=True))
    op.execute("UPDATE pull_requests SET type_new = type::text")
    op.execute("UPDATE pull_requests SET type_new = 'batch'")
    op.drop_column("pull_requests", "type")
    op.alter_column("pull_requests", "type_new", new_column_name="type", nullable=False)

    # 3. Drop the old PRType enum (safe since no column references it anymore)
    op.execute("DROP TYPE IF EXISTS prtype")

    # 4. Add summary_types column for filtering
    op.add_column(
        "pull_requests",
        sa.Column(
            "summary_types",
            sa.dialects.postgresql.JSONB(),
            server_default="[]",
            nullable=False,
        ),
    )

    # 5. Populate summary_types from existing payloads
    op.execute("""
        UPDATE pull_requests
        SET summary_types = (
            SELECT COALESCE(
                (SELECT jsonb_agg(DISTINCT elem->>'op') FROM jsonb_array_elements(payload) AS elem WHERE elem->>'op' IS NOT NULL),
                (SELECT jsonb_agg(DISTINCT elem->>'pr_type') FROM jsonb_array_elements(payload) AS elem WHERE elem->>'pr_type' IS NOT NULL),
                '[]'::jsonb
            )
        )
    """)

    # 6. Recreate the view that was dropped in step 0
    op.execute("""
        CREATE VIEW pull_requests_with_score AS
        SELECT pr.*,
               COALESCE((SELECT SUM(value) FROM pr_votes WHERE pr_id = pr.id), 0) AS vote_score,
               (SELECT COUNT(*) FROM pr_votes WHERE pr_id = pr.id AND value = 1)  AS upvotes,
               (SELECT COUNT(*) FROM pr_votes WHERE pr_id = pr.id AND value = -1) AS downvotes
        FROM pull_requests pr
    """)


def downgrade() -> None:
    # Drop the view before modifying columns
    op.execute("DROP VIEW IF EXISTS pull_requests_with_score")

    # Remove summary_types column
    op.drop_column("pull_requests", "summary_types")

    # Recreate enum
    prtype_enum = sa.Enum(
        "create_material", "edit_material", "delete_material",
        "create_directory", "edit_directory", "delete_directory", "move_item",
        name="prtype",
    )
    prtype_enum.create(op.get_bind(), checkfirst=True)

    # Restore type column as enum
    op.add_column("pull_requests", sa.Column("type_old", prtype_enum, nullable=True))
    op.execute("""
        UPDATE pull_requests SET type_old = (
            CASE
                WHEN payload->0->>'pr_type' IS NOT NULL THEN (payload->0->>'pr_type')::prtype
                WHEN payload->0->>'op' IS NOT NULL THEN (payload->0->>'op')::prtype
                ELSE 'create_material'::prtype
            END
        )
    """)
    op.drop_column("pull_requests", "type")
    op.alter_column("pull_requests", "type_old", new_column_name="type", nullable=False)

    # Unwrap single-element arrays back to objects
    op.execute("""
        UPDATE pull_requests
        SET payload = payload->0
        WHERE jsonb_typeof(payload) = 'array' AND jsonb_array_length(payload) = 1
    """)

    # Recreate the view with original schema
    op.execute("""
        CREATE VIEW pull_requests_with_score AS
        SELECT pr.*,
               COALESCE((SELECT SUM(value) FROM pr_votes WHERE pr_id = pr.id), 0) AS vote_score,
               (SELECT COUNT(*) FROM pr_votes WHERE pr_id = pr.id AND value = 1)  AS upvotes,
               (SELECT COUNT(*) FROM pr_votes WHERE pr_id = pr.id AND value = -1) AS downvotes
        FROM pull_requests pr
    """)
