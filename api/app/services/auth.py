import random
from datetime import UTC, datetime

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import create_access_token, create_refresh_token
from app.models.user import User, UserRole

ALLOWED_DOMAINS = ("@telecom-sudparis.eu", "@imt-bs.eu")
CODE_TTL_SECONDS = 600
RATE_LIMIT_TTL_SECONDS = 600
RATE_LIMIT_MAX = 3


def validate_email(email: str) -> str:
    email = email.strip().lower()
    if "+" in email:
        raise ValueError("Email aliases with '+' are not allowed")
    if not any(email.endswith(d) for d in ALLOWED_DOMAINS):
        raise ValueError("Only school emails are allowed")
    return email


def generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


async def store_code(redis: Redis, email: str, code: str) -> None:
    await redis.setex(f"auth:code:{email}", CODE_TTL_SECONDS, code)


async def verify_code(redis: Redis, email: str, code: str) -> bool:
    if settings.is_dev and code == "000000":
        return True

    stored = await redis.get(f"auth:code:{email}")
    if stored and stored == code:
        await redis.delete(f"auth:code:{email}")
        return True
    return False


async def check_rate_limit(redis: Redis, email: str) -> bool:
    if settings.is_dev:
        return True

    key = f"auth:rate:{email}"
    count = await redis.get(key)
    if count and int(count) >= RATE_LIMIT_MAX:
        return False
    pipe = redis.pipeline()
    pipe.incr(key)
    pipe.expire(key, RATE_LIMIT_TTL_SECONDS)
    await pipe.execute()
    return True


async def get_or_create_user(db: AsyncSession, email: str) -> tuple[User, bool]:
    result = await db.execute(select(User).where(User.email == email, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user:
        user.last_login_at = datetime.now(UTC)
        return user, False
    user = User(email=email, role=UserRole.STUDENT)
    db.add(user)
    await db.flush()
    return user, True


def issue_tokens(user: User) -> tuple[str, str, str]:
    access_token, jti = create_access_token(
        user_id=str(user.id), role=user.role.value, email=user.email
    )
    refresh_token = create_refresh_token(user_id=str(user.id))
    return access_token, refresh_token, jti


async def blacklist_token(redis: Redis, jti: str, ttl_seconds: int) -> None:
    await redis.setex(f"auth:blacklist:{jti}", ttl_seconds, "1")


async def is_token_blacklisted(redis: Redis, jti: str) -> bool:
    result = await redis.get(f"auth:blacklist:{jti}")
    return result is not None
