import logging
from datetime import UTC, datetime, timedelta

logger = logging.getLogger("wikint")


async def cleanup_uploads(ctx: dict) -> None:
    logger.info("Running upload cleanup cron job")
    try:
        from app.config import settings
        from app.core.minio import delete_object, get_s3_client

        cutoff = datetime.now(UTC) - timedelta(hours=24)

        async with get_s3_client() as client:
            paginator = client.get_paginator("list_objects_v2")
            async for page in paginator.paginate(Bucket=settings.minio_bucket, Prefix="uploads/"):
                for obj in page.get("Contents", []):
                    if obj["LastModified"].replace(tzinfo=None) < cutoff.replace(tzinfo=None):
                        logger.info("Deleting stale upload: %s", obj["Key"])
                        await delete_object(obj["Key"])
    except Exception as e:
        logger.error("Upload cleanup failed: %s", e)
