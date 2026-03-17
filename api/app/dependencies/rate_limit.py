from typing import Annotated

from fastapi import Depends, Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.database import get_db
from app.core.exceptions import RateLimitError
from app.core.redis import get_redis
from app.dependencies.auth import CurrentUser
from app.services.audit import flag_user_account


async def rate_limit_downloads(
    request: Request,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> None:
    minute_limit = 100 if settings.is_dev else 10
    daily_limit = 2000 if settings.is_dev else 200

    user_id = str(user.id)

    minute_key = f"ratelimit:downloads:min:{user_id}"
    daily_key = f"ratelimit:downloads:day:{user_id}"

    async with redis.pipeline(transaction=True) as pipe:
        await pipe.incr(minute_key)
        await pipe.expire(minute_key, 60, nx=True)

        await pipe.incr(daily_key)
        await pipe.expire(daily_key, 86400, nx=True)

        results = await pipe.execute()

    minute_count = results[0]
    daily_count = results[2]

    if minute_count > minute_limit:
        raise RateLimitError(
            f"You are downloading too fast. Limit: {minute_limit} files per minute."
        )

    if daily_count > daily_limit:
        await flag_user_account(
            db, user.id, f"Exceeded daily download limit ({daily_count}/{daily_limit})"
        )
        await db.commit()
        raise RateLimitError(
            f"Daily download limit reached ({daily_limit} files). Please try again tomorrow."
        )


async def rate_limit_uploads(
    request: Request,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> None:
    minute_limit = 100 if settings.is_dev else 10
    daily_limit = 1000 if settings.is_dev else 100

    user_id = str(user.id)

    minute_key = f"ratelimit:uploads:min:{user_id}"
    daily_key = f"ratelimit:uploads:day:{user_id}"

    async with redis.pipeline(transaction=True) as pipe:
        await pipe.incr(minute_key)
        await pipe.expire(minute_key, 60, nx=True)

        await pipe.incr(daily_key)
        await pipe.expire(daily_key, 86400, nx=True)

        results = await pipe.execute()

    minute_count = results[0]
    daily_count = results[2]

    if minute_count > minute_limit:
        raise RateLimitError(f"You are uploading too fast. Limit: {minute_limit} files per minute.")

    if daily_count > daily_limit:
        await flag_user_account(
            db, user.id, f"Exceeded daily upload limit ({daily_count}/{daily_limit})"
        )
        await db.commit()
        raise RateLimitError(
            f"Daily upload limit reached ({daily_limit} files). Please try again tomorrow."
        )
