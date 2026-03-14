import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.database import get_db
from app.core.redis import get_redis
from app.dependencies.auth import CurrentUser
from app.dependencies.pagination import PaginationParams
from app.schemas.common import PaginatedResponse
from app.schemas.notification import NotificationOut
from app.services.notification import (
    get_notifications,
    mark_all_read,
    mark_read,
    register_sse,
    unregister_sse,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=PaginatedResponse[NotificationOut])
async def list_notifications(
    user: CurrentUser,
    pagination: Annotated[PaginationParams, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
    read: Annotated[bool | None, Query()] = None,
) -> PaginatedResponse[NotificationOut]:
    items, total = await get_notifications(
        db, user.id, pagination.limit, pagination.offset, read
    )
    return PaginatedResponse(
        items=[NotificationOut.model_validate(n) for n in items],
        total=total,
        page=pagination.page,
        pages=(total + pagination.limit - 1) // pagination.limit if total > 0 else 1,
    )


@router.patch("/{notification_id}/read", response_model=NotificationOut)
async def read_notification(
    notification_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> NotificationOut:
    notif = await mark_read(db, notification_id, user.id)
    return NotificationOut.model_validate(notif)


@router.post("/read-all")
async def read_all_notifications(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, int]:
    count = await mark_all_read(db, user.id)
    return {"marked": count}


@router.get("/sse")
async def sse_stream(
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    token: str | None = Query(None),
) -> EventSourceResponse:
    """SSE endpoint. Accepts token via query param since EventSource can't send headers."""
    from jwt import InvalidTokenError as _JwtError

    from app.core.exceptions import UnauthorizedError
    from app.core.security import decode_token
    from app.services.auth import is_token_blacklisted
    from app.services.user import get_user_by_id

    if not token:
        raise UnauthorizedError("Token required as query parameter")

    try:
        payload = decode_token(token)
    except _JwtError:
        raise UnauthorizedError("Invalid token")

    if payload.get("type") != "access":
        raise UnauthorizedError("Invalid token type")

    jti = payload.get("jti")
    if jti and await is_token_blacklisted(redis, jti):
        raise UnauthorizedError("Token revoked")

    user = await get_user_by_id(db, payload.get("sub"))
    if not user:
        raise UnauthorizedError("User not found")

    queue = register_sse(user.id)
    uid = user.id

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    if event.get("type") == "close":
                        break
                    yield {"event": "notification", "data": str(event)}
                except TimeoutError:
                    yield {"event": "ping", "data": ""}
        finally:
            unregister_sse(uid)

    return EventSourceResponse(event_generator())
