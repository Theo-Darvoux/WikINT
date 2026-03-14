import logging

logger = logging.getLogger("wikint")


async def process_upload(ctx: dict, file_key: str) -> None:
    logger.info("Processing upload: %s", file_key)
    try:
        from app.core.minio import get_object_info

        info = await get_object_info(file_key)
        logger.info("Upload metadata: size=%d, type=%s", info["size"], info["content_type"])
    except Exception as e:
        logger.error("Failed to process upload %s: %s", file_key, e)
