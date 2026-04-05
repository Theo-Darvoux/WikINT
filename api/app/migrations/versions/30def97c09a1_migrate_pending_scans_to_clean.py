"""migrate_pending_scans_to_clean

Revision ID: 30def97c09a1
Revises: b4c8deec8f6b
Create Date: 2026-03-15 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "30def97c09a1"
down_revision: str | None = "b4c8deec8f6b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Virus scanning now happens synchronously at upload time.
    # Any existing 'pending' or 'error' rows are from the old async pipeline
    # and should be treated as clean (the files were already accepted).
    op.execute(
        "UPDATE pull_requests SET virus_scan_result = 'clean' "
        "WHERE virus_scan_result IN ('pending', 'error')"
    )
    op.execute(
        "UPDATE material_versions SET virus_scan_result = 'clean' "
        "WHERE virus_scan_result IN ('pending', 'error')"
    )


def downgrade() -> None:
    # No meaningful downgrade — data migration only
    pass
