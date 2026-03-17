import asyncio

from arq.connections import RedisSettings
from redis.asyncio import Redis

from app.config import settings


async def test():
    print(f"Testing REDIS_URL: {settings.redis_url}")
    try:
        r = Redis.from_url(settings.redis_url)
        await r.ping()
        print("Redis PING successful")
    except Exception as e:
        print(f"Redis PING failed: {e}")

    try:
        rs = RedisSettings.from_dsn(settings.redis_url)
        print(
            f"arq RedisSettings: host={rs.host}, port={rs.port}, password={'REDACTED' if rs.password else 'None'}"
        )
    except Exception as e:
        print(f"arq RedisSettings failed: {e}")


if __name__ == "__main__":
    asyncio.run(test())
