import secrets
from datetime import UTC, datetime

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import create_access_token, create_refresh_token
from app.models.user import User, UserRole

ALLOWED_DOMAINS = ("@telecom-sudparis.eu", "@imt-bs.eu")
CODE_TTL_SECONDS = 900
RATE_LIMIT_TTL_SECONDS = 900
RATE_LIMIT_MAX = 3
VERIFY_RATE_LIMIT_MAX = 5
VERIFY_RATE_LIMIT_TTL_SECONDS = 600


def validate_email(email: str) -> str:
    email = email.strip().lower()
    if "+" in email:
        raise ValueError("Email aliases with '+' are not allowed")
    if not any(email.endswith(d) for d in ALLOWED_DOMAINS):
        raise ValueError("Only school emails are allowed")
    return email


def generate_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def generate_magic_token() -> str:
    return secrets.token_urlsafe(48)


async def store_code(redis: Redis, email: str, code: str) -> None:
    await redis.setex(f"auth:code:{email}", CODE_TTL_SECONDS, code)


async def store_magic_token(redis: Redis, email: str, token: str) -> None:
    await redis.setex(f"auth:magic:{token}", CODE_TTL_SECONDS, email)
    await redis.setex(f"auth:magic_ref:{email}", CODE_TTL_SECONDS, token)


async def verify_code(redis: Redis, email: str, code: str) -> bool:
    if settings.is_dev and code == "00000000":
        return True

    stored = await redis.get(f"auth:code:{email}")
    if stored and stored == code:
        await redis.delete(f"auth:code:{email}")
        magic_token = await redis.get(f"auth:magic_ref:{email}")
        if magic_token:
            await redis.delete(f"auth:magic:{magic_token}")
            await redis.delete(f"auth:magic_ref:{email}")
        return True
    return False


async def verify_magic_token(redis: Redis, token: str) -> str | None:
    email = await redis.get(f"auth:magic:{token}")
    if not email:
        return None

    await redis.delete(f"auth:magic:{token}")
    await redis.delete(f"auth:magic_ref:{email}")
    await redis.delete(f"auth:code:{email}")
    return email


async def check_rate_limit(redis: Redis, email: str) -> bool:
    if settings.is_dev:
        return True

    key = f"auth:rate:{email}"
    count = await redis.get(key)
    if count and int(count) >= RATE_LIMIT_MAX:
        return False
    pipe = redis.pipeline()
    await pipe.incr(key)
    await pipe.expire(key, RATE_LIMIT_TTL_SECONDS)
    await pipe.execute()
    return True


async def check_verify_rate_limit(redis: Redis, email: str) -> bool:
    if settings.is_dev:
        return True

    key = f"auth:verify_rate:{email}"
    count = await redis.get(key)
    if count and int(count) >= VERIFY_RATE_LIMIT_MAX:
        return False
    return True


async def increment_verify_rate_limit(redis: Redis, email: str) -> None:
    if settings.is_dev:
        return
    key = f"auth:verify_rate:{email}"
    pipe = redis.pipeline()
    await pipe.incr(key)
    await pipe.expire(key, VERIFY_RATE_LIMIT_TTL_SECONDS)
    await pipe.execute()


async def reset_verify_rate_limit(redis: Redis, email: str) -> None:
    await redis.delete(f"auth:verify_rate:{email}")


async def get_or_create_user(db: AsyncSession, email: str) -> tuple[User, bool]:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        if user.deleted_at is not None:
            user.deleted_at = None
            user.onboarded = False
            user.last_login_at = datetime.now(UTC)
            await db.flush()
            return user, True

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
