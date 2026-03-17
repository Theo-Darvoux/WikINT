from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from redis.asyncio import Redis
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.database import get_db
from app.core.exceptions import BadRequestError, RateLimitError, UnauthorizedError
from app.core.redis import get_redis
from app.core.security import create_access_token, decode_token
from app.dependencies.auth import CurrentUser
from app.schemas.auth import (
    RefreshResponse,
    RequestCodeIn,
    TokenResponse,
    UserBrief,
    VerifyCodeIn,
)
from app.services import auth as auth_service
from app.services.email import send_verification_code

router = APIRouter(prefix="/api/auth", tags=["auth"])

def get_client_id(request: Request) -> str:
    client_id = request.headers.get("x-client-id")
    if client_id:
        return client_id
    return get_remote_address(request)

limiter = Limiter(key_func=get_client_id, enabled=not settings.is_dev)


@router.post("/request-code")
@limiter.limit("3/15minutes" if not settings.is_dev else "10000/minute")
async def request_code(
    request: Request,
    data: RequestCodeIn,
    redis: Annotated[Redis, Depends(get_redis)],
) -> dict[str, str]:
    email = data.email
    if not await auth_service.check_rate_limit(redis, email):
        raise RateLimitError(
            "Too many code requests. You can request up to 3 codes per 10 minutes. Please wait before trying again."
        )

    code = auth_service.generate_code()
    await auth_service.store_code(redis, email, code)

    try:
        await send_verification_code(email, code)
    except Exception as e:
        import logging

        logging.getLogger("wikint").error(f"Failed to send verification email: {e}", exc_info=True)

    return {"message": "Verification code sent"}


@router.post("/verify-code", response_model=TokenResponse)
async def verify_code(
    data: VerifyCodeIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    response: Response,
) -> TokenResponse:
    email = data.email.strip().lower()

    if not await auth_service.check_verify_rate_limit(redis, email):
        raise RateLimitError(
            "Too many verification attempts. Please wait 10 minutes before trying again."
        )

    if not await auth_service.verify_code(redis, email, data.code):
        await auth_service.increment_verify_rate_limit(redis, email)
        raise BadRequestError("Invalid or expired verification code")

    await auth_service.reset_verify_rate_limit(redis, email)
    user, is_new = await auth_service.get_or_create_user(db, email)
    access_token, refresh_token, _ = auth_service.issue_tokens(user)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=31 * 24 * 3600,
        path="/api/auth/refresh",
    )

    return TokenResponse(
        access_token=access_token,
        user=UserBrief(
            id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            avatar_url=user.avatar_url,
            role=user.role.value,
            onboarded=user.onboarded,
        ),
        is_new_user=is_new,
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> RefreshResponse:
    token = request.cookies.get("refresh_token")
    if not token:
        raise UnauthorizedError("No refresh token")

    try:
        payload = decode_token(token)
    except Exception:
        raise UnauthorizedError("Invalid refresh token")

    if payload.get("type") != "refresh":
        raise UnauthorizedError("Invalid token type")

    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("Invalid token")

    from app.services.user import get_user_by_id

    user = await get_user_by_id(db, user_id)
    if not user:
        raise UnauthorizedError("User not found")

    new_access_token, _ = create_access_token(
        user_id=str(user.id), role=user.role.value, email=user.email
    )

    return RefreshResponse(access_token=new_access_token)


@router.post("/logout")
async def logout(
    user: CurrentUser,
    redis: Annotated[Redis, Depends(get_redis)],
    request: Request,
) -> dict[str, str]:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = decode_token(token)
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                remaining = int(exp - datetime.now(UTC).timestamp())
                if remaining > 0:
                    await auth_service.blacklist_token(redis, jti, remaining)
        except Exception:
            pass

    return {"message": "Logged out"}
