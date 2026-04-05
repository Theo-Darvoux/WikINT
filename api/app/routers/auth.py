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
from app.core.security import decode_token
from app.dependencies.auth import CurrentUser
from app.schemas.auth import (
    RefreshResponse,
    RequestCodeIn,
    TokenResponse,
    UserBrief,
    VerifyCodeIn,
    VerifyMagicLinkIn,
)
from app.services import auth as auth_service
from app.services.email import send_verification_email

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def require_client_id(request: Request):
    if not request.headers.get("x-client-id"):
        raise UnauthorizedError("Missing Client-ID header (CSRF Protection)")


def get_client_id(request: Request) -> str:
    ip = get_remote_address(request)
    client_id = request.headers.get("x-client-id", "unknown")

    return f"{ip}:{client_id}"


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
            "Too many code requests. You can request up to 3 codes per 15 minutes. Please wait before trying again."
        )

    code = auth_service.generate_code()
    await auth_service.store_code(redis, email, code)

    magic_token = auth_service.generate_magic_token()
    await auth_service.store_magic_token(redis, email, magic_token)
    magic_link = f"{settings.frontend_url}/login/verify?token={magic_token}"

    try:
        await send_verification_email(email, code, magic_link)
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
        path="/api/auth/",
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


@router.post("/verify-magic-link", response_model=TokenResponse)
@limiter.limit("10/15minutes" if not settings.is_dev else "10000/minute")
async def verify_magic_link(
    request: Request,
    data: VerifyMagicLinkIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    response: Response,
) -> TokenResponse:
    email = await auth_service.verify_magic_token(redis, data.token)
    if not email:
        raise BadRequestError("Invalid or expired magic link")

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
        path="/api/auth/",
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


@router.post("/refresh", response_model=RefreshResponse, dependencies=[Depends(require_client_id)])
async def refresh_token(
    request: Request,
    response: Response,
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

    jti = payload.get("jti")
    if jti and await auth_service.is_token_blacklisted(redis, jti):
        raise UnauthorizedError("Refresh token has been revoked")

    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("Invalid token")

    from app.services.user import get_user_by_id

    user = await get_user_by_id(db, user_id)
    if not user:
        raise UnauthorizedError("User not found")

    old_jti = payload.get("jti")
    old_exp = payload.get("exp")
    if old_jti and old_exp:
        remaining = int(old_exp - datetime.now(UTC).timestamp())
        if remaining > 0:
            await auth_service.blacklist_token(redis, old_jti, remaining)

    new_access_token, new_refresh_token, _ = auth_service.issue_tokens(user)

    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=31 * 24 * 3600,
        path="/api/auth/",
    )

    return RefreshResponse(access_token=new_access_token)


@router.post("/logout", dependencies=[Depends(require_client_id)])
async def logout(
    user: CurrentUser,
    redis: Annotated[Redis, Depends(get_redis)],
    request: Request,
    response: Response,
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

    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        try:
            refresh_payload = decode_token(refresh_token)
            refresh_jti = refresh_payload.get("jti")
            refresh_exp = refresh_payload.get("exp")
            if refresh_jti and refresh_exp:
                remaining = int(refresh_exp - datetime.now(UTC).timestamp())
                if remaining > 0:
                    await auth_service.blacklist_token(redis, refresh_jti, remaining)
        except Exception:
            pass

    response.delete_cookie(
        key="refresh_token",
        path="/api/auth/",
        secure=True,
        httponly=True,
        samesite="strict",
    )

    return {"message": "Logged out"}
