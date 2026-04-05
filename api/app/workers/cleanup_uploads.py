import logging
from datetime import UTC, datetime, timedelta

logger = logging.getLogger("wikint")


async def cleanup_uploads(ctx: dict) -> None:
    logger.info("Running upload cleanup cron job")
    from sqlalchemy import select, update

    from app.config import settings
    from app.core.database import async_session_factory
    from app.core.storage import get_s3_client
    from app.models.pull_request import PRStatus, PullRequest

    # ── 1. Expire old Pull Requests (7 days) ─────────────────────────────────
    pr_cutoff = datetime.now(UTC) - timedelta(days=7)

    async with async_session_factory() as db:
        # Update PRs to REJECTED if they've been idle for 7 days
        expire_stmt = (
            update(PullRequest)
            .where(PullRequest.status == PRStatus.OPEN)
            .where(PullRequest.updated_at < pr_cutoff)
            .values(status=PRStatus.REJECTED)
        )
        from typing import cast

        from sqlalchemy.engine import CursorResult
        res = cast(CursorResult, await db.execute(expire_stmt))
        await db.commit()
        if res.rowcount > 0:
            logger.info("Expired %d stale Pull Requests (older than 7 days)", res.rowcount)

    # ── 1c. Abort stale Multipart Uploads (24 hours) (Issue 4) ─────────────
    # S3 multipart uploads that are never completed consume hidden storage.
    # We must explicitly list and abort them.
    from app.core.storage import abort_multipart_upload, list_multipart_uploads
    mp_cutoff = datetime.now(UTC) - timedelta(hours=24)
    mp_aborted = 0

    async for mp in list_multipart_uploads():
        # mp['Initiated'] is already a datetime object from botocore
        initiated = mp["Initiated"]
        if isinstance(initiated, datetime) and initiated < mp_cutoff:
            await abort_multipart_upload(cast(str, mp["Key"]), cast(str, mp["UploadId"]))
            mp_aborted += 1

    if mp_aborted > 0:
        logger.info("Aborted %d stale S3 multipart uploads (older than 24h)", mp_aborted)

    # ── 1b. Expire stale pending Uploads (2 hours) — audit fix #8 ─────────
    pending_cutoff = datetime.now(UTC) - timedelta(hours=2)

    async with async_session_factory() as db:
        from app.models.upload import Upload

        pending_stmt = (
            update(Upload)
            .where(Upload.status == "pending")
            .where(Upload.created_at < pending_cutoff)
            .values(status="failed", error_detail="Upload never completed (timed out)")
        )
        pending_res = cast(CursorResult, await db.execute(pending_stmt))
        await db.commit()
        if pending_res.rowcount > 0:
            logger.info("Expired %d stale pending uploads (older than 2h)", pending_res.rowcount)

    # ── 2. Collect protected keys ────────────────────────────────────────────
    # Only OPEN or APPROVED (pending merge) PRs protect their files.
    protected_keys: set[str] = set()
    async with async_session_factory() as db:
        result = await db.execute(
            select(PullRequest).where(PullRequest.status.in_([PRStatus.OPEN, PRStatus.APPROVED]))
        )
        for pr in result.scalars():
            payload = cast(list[dict], pr.payload)
            for op in payload:
                fk = op.get("file_key")
                if fk:
                    protected_keys.add(fk)
                attachments = cast(list[dict], op.get("attachments", []))
                for att in attachments:
                    att_fk = att.get("file_key")
                    if att_fk:
                        protected_keys.add(att_fk)

    # 3. Clean uploads/ (staging area for PRs)
    # Since the S3 Lifecycle Rule will also be active, this serves as a
    # fallback and handles immediate cleanup of recently rejected/closed PRs.
    # (A8) 48h safety margin for orphan cleanup.
    # We use a 48h cutoff to ensure that files created during long apply_pr transactions
    # or mid-upload aren't prematurely deleted.
    orphan_cutoff = datetime.now(UTC) - timedelta(hours=48)
    quarantine_cutoff = datetime.now(UTC) - timedelta(hours=2)

    to_delete: list[str] = []

    # 3.8: Status-based cleanup — query DB for terminal uploads instead of S3 prefix scan.
    # This is more efficient and avoids listing potentially millions of S3 objects.
    async with async_session_factory() as db:
        from sqlalchemy import select

        from app.models.upload import Upload

        terminal_statuses = ["clean", "failed", "malicious"]
        upload_result = await db.execute(
            select(Upload).where(
                Upload.status.in_(terminal_statuses),
                Upload.updated_at < orphan_cutoff,
            )
        )
        terminal_uploads: list[Upload] = list(upload_result.scalars().all())

    for upload in terminal_uploads:
        # Skip if the file is referenced by an active PR
        if upload.final_key and upload.final_key not in protected_keys:
            to_delete.append(upload.final_key)
        elif upload.quarantine_key and upload.quarantine_key not in protected_keys:
            to_delete.append(upload.quarantine_key)

    # 2. Clean quarantine/ files older than quarantine_cutoff via S3 scan.
    # (These may have no DB row — e.g. direct uploads before DB row was created.)
    async with get_s3_client() as client:
        paginator = client.get_paginator("list_objects_v2")

        async for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix="quarantine/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if obj["LastModified"].replace(tzinfo=None) < quarantine_cutoff.replace(tzinfo=None):
                    to_delete.append(key)

    if to_delete:
        from app.workers.storage_ops import delete_storage_objects
        await delete_storage_objects(ctx, to_delete)
        logger.info("Cleanup triggered for %d staging/quarantine objects", len(to_delete))

    # ── 4. Clean orphaned materials/ and cas/ (A4) ───────────────────────────
    # Integrated from cleanup_orphans.py to provide a single cleanup path.
    from app.models.material import MaterialVersion

    valid_keys: set[str] = set()


    async with async_session_factory() as db:
        # Collect all active file_keys
        result = await db.execute(
            select(MaterialVersion.file_key).where(MaterialVersion.file_key.is_not(None))
        )
        valid_keys = {row[0] for row in result if row[0]}

        pass

    orphans_to_delete: list[str] = []
    async with get_s3_client() as client:
        paginator = client.get_paginator("list_objects_v2")
        # Check materials/
        async for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix="materials/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key in valid_keys:
                    continue
                if obj["LastModified"].replace(tzinfo=None) < orphan_cutoff.replace(tzinfo=None):
                    orphans_to_delete.append(key)

        # Check cas/
        redis = ctx["redis"]
        cas_keys_raw = await redis.keys("upload:cas:*")
        valid_cas_ids = {
            (k.decode() if isinstance(k, bytes) else k).split(":")[-1]
            for k in cas_keys_raw
        }

        async for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix="cas/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                cas_id = key.split("/")[-1]
                if cas_id in valid_cas_ids:
                    continue
                if obj["LastModified"].replace(tzinfo=None) < orphan_cutoff.replace(tzinfo=None):
                    orphans_to_delete.append(key)

    if orphans_to_delete:
        from app.workers.storage_ops import delete_storage_objects
        await delete_storage_objects(ctx, orphans_to_delete)
        logger.info("Cleanup triggered for %d orphaned objects", len(orphans_to_delete))
    else:
        logger.info("No orphaned objects found to clean up")
