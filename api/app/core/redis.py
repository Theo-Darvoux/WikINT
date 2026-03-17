from collections.abc import AsyncGenerator

from arq.connections import ArqRedis, RedisSettings, create_pool
from redis.asyncio import Redis

from app.config import settings

redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
arq_pool: ArqRedis | None = None


async def get_redis() -> AsyncGenerator[Redis, None]:
    yield redis_client


async def init_arq_pool() -> None:
    global arq_pool
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))


async def close_arq_pool() -> None:
    if arq_pool:
        await arq_pool.close()
