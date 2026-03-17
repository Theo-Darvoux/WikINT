import logging

from app.core.minio import delete_object

logger = logging.getLogger("wikint")


async def delete_minio_objects(ctx: dict, keys: list[str]) -> None:
    """Delete a list of object keys from MinIO."""
    for key in keys:
        try:
            await delete_object(key)
            logger.info("Deleted orphaned/removed MinIO object: %s", key)
        except Exception as e:
            logger.error("Failed to delete MinIO object %s: %s", key, e)
