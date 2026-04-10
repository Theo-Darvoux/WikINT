from typing import Any

from app.config import settings


class UploadCacheRepository:
    """Encapsulates Redis operations for upload pipeline."""

    def __init__(self, redis_client: Any) -> None:
        self.redis = redis_client

    async def emit_event(
        self,
        status_key: str,
        event_channel: str,
        event_log_key: str,
        payload_json: str,
    ) -> None:
        await self.redis.set(
            status_key,
            payload_json,
            ex=settings.cache_ttl_seconds if hasattr(settings, "cache_ttl_seconds") else 3600,
        )

        # Append to the durable event log BEFORE publishing to pub/sub so that
        # any SSE subscriber that receives the pub/sub message and then checks
        # the log length will see a consistent view.
        idx = await self.redis.rpush(event_log_key, payload_json)
        if idx == 1:
            await self.redis.expire(event_log_key, 7200)
        elif idx > 200:
            await self.redis.ltrim(event_log_key, -200, -1)

        await self.redis.publish(event_channel, payload_json)

    async def is_cancelled(self, cancel_key: str) -> bool:
        return int(await self.redis.exists(cancel_key)) > 0
