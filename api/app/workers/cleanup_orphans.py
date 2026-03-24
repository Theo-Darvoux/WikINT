import logging
from datetime import UTC, datetime, timedelta

logger = logging.getLogger("wikint")


async def cleanup_orphans(ctx: dict) -> None:
    logger.info("Running orphaned object cleanup cron job")
    from sqlalchemy import select

    from app.config import settings
    from app.core.database import async_session_factory
    from app.core.storage import delete_object, get_s3_client
    from app.models.material import MaterialVersion

    # Collect all file_keys currently referenced in the database for materials
    valid_keys: set[str] = set()
    async with async_session_factory() as db:
        result = await db.execute(
            select(MaterialVersion.file_key).where(MaterialVersion.file_key.is_not(None))
        )
        for row in result:
            if row[0]:
                valid_keys.add(row[0])

    # We wait at least 24 hours to delete anything that might be mid-transition
    # or just created and not fully committed (though we're doing things atomically)
    cutoff = datetime.now(UTC) - timedelta(hours=24)

    deleted = errors = 0
    async with get_s3_client() as client:
        paginator = client.get_paginator("list_objects_v2")
        # Check all files inside materials/
        async for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix="materials/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key in valid_keys:
                    continue
                if obj["LastModified"].replace(tzinfo=None) < cutoff.replace(tzinfo=None):
                    try:
                        await delete_object(key)
                        logger.info("Deleted orphaned MinIO object: %s", key)
                        deleted += 1
                    except Exception as e:
                        logger.error("Failed to delete orphaned %s: %s", key, e)
                        errors += 1

    logger.info("Orphan cleanup done: %d deleted, %d errors", deleted, errors)
