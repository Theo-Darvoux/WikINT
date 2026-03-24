import logging
from datetime import UTC, datetime, timedelta

logger = logging.getLogger("wikint")


async def cleanup_uploads(ctx: dict) -> None:
    logger.info("Running upload cleanup cron job")
    from sqlalchemy import select

    from app.config import settings
    from app.core.database import async_session_factory
    from app.core.storage import delete_object, get_s3_client
    from app.models.pull_request import PRStatus, PullRequest

    # Collect all file_keys referenced by open PRs — these must not be deleted
    protected_keys: set[str] = set()
    async with async_session_factory() as db:
        result = await db.execute(select(PullRequest).where(PullRequest.status == PRStatus.OPEN))
        for pr in result.scalars():
            for op in pr.payload:
                fk = op.get("file_key")
                if fk:
                    protected_keys.add(fk)
                for att in op.get("attachments", []):
                    att_fk = att.get("file_key") if isinstance(att, dict) else None
                    if att_fk:
                        protected_keys.add(att_fk)

    cutoff = datetime.now(UTC) - timedelta(hours=24)

    deleted = errors = 0
    async with get_s3_client() as client:
        paginator = client.get_paginator("list_objects_v2")
        async for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix="uploads/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key in protected_keys:
                    logger.debug("Skipping protected upload (open PR): %s", key)
                    continue
                if obj["LastModified"].replace(tzinfo=None) < cutoff.replace(tzinfo=None):
                    try:
                        await delete_object(key)
                        deleted += 1
                    except Exception as e:
                        logger.error("Failed to delete %s: %s", key, e)
                        errors += 1
    logger.info("Cleanup done: %d deleted, %d errors", deleted, errors)
