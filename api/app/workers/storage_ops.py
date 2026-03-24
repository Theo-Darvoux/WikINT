import logging

from app.core.storage import delete_object

logger = logging.getLogger("wikint")


async def delete_storage_objects(ctx: dict, keys: list[str]) -> None:
    """Delete a list of object keys from S3-compatible storage."""
    for key in keys:
        try:
            await delete_object(key)
            logger.info("Deleted orphaned/removed storage object: %s", key)
        except Exception as e:
            logger.error("Failed to delete storage object %s: %s", key, e)
