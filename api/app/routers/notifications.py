from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.database import get_db
from app.core.sse import register_user_queue, sse_event_stream, unregister_user_queue
from app.dependencies.auth import CurrentUser, SSEUser
from app.dependencies.pagination import PaginationParams
from app.schemas.common import PaginatedResponse
from app.schemas.notification import NotificationOut
from app.services.notification import (
    get_notifications,
    mark_all_read,
    mark_read,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=PaginatedResponse[NotificationOut])
async def list_notifications(
    user: CurrentUser,
    pagination: Annotated[PaginationParams, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
    read: Annotated[bool | None, Query()] = None,
) -> PaginatedResponse[NotificationOut]:
    items, total = await get_notifications(db, user.id, pagination.limit, pagination.offset, read)
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
async def sse_stream(user: SSEUser) -> EventSourceResponse:
    """SSE endpoint. Accepts token via query param since EventSource can't send headers."""
    queue = register_user_queue(user.id)
    return EventSourceResponse(
        sse_event_stream(
            queue,
            cleanup=lambda: unregister_user_queue(user.id, queue),
            event_name="notification",
        )
    )
