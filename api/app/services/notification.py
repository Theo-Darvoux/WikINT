import asyncio
import logging
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User, UserRole

logger = logging.getLogger("wikint")

_sse_queues: dict[uuid.UUID, asyncio.Queue[dict]] = {}
_material_queues: dict[str, list[asyncio.Queue[dict]]] = {}

MODERATOR_ROLES = (UserRole.MEMBER, UserRole.BUREAU, UserRole.VIEUX)


def register_sse(user_id: uuid.UUID) -> asyncio.Queue[dict]:
    old = _sse_queues.pop(user_id, None)
    if old:
        old.put_nowait({"type": "close"})
    q: asyncio.Queue[dict] = asyncio.Queue()
    _sse_queues[user_id] = q
    return q


def unregister_sse(user_id: uuid.UUID) -> None:
    _sse_queues.pop(user_id, None)


def register_material_watcher(material_id: str) -> asyncio.Queue[dict]:
    q: asyncio.Queue[dict] = asyncio.Queue()
    _material_queues.setdefault(material_id, []).append(q)
    return q


def unregister_material_watcher(material_id: str, q: asyncio.Queue[dict]) -> None:
    queues = _material_queues.get(material_id, [])
    try:
        queues.remove(q)
    except ValueError:
        pass
    if not queues:
        _material_queues.pop(material_id, None)


def broadcast_material_event(material_id: str, event: dict) -> None:
    for q in list(_material_queues.get(material_id, [])):
        q.put_nowait(event)


def _broadcast(user_id: uuid.UUID, event: dict) -> None:
    q = _sse_queues.get(user_id)
    if q:
        q.put_nowait(event)


async def create_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    notification_type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        type=notification_type,
        title=title,
        body=body,
        link=link,
    )
    db.add(notif)
    await db.flush()
    _broadcast(user_id, {
        "type": "notification",
        "id": str(notif.id),
        "notification_type": notification_type,
        "title": title,
    })
    return notif


async def get_notifications(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int,
    offset: int,
    read_filter: bool | None = None,
) -> tuple[list[Notification], int]:
    base = select(Notification).where(Notification.user_id == user_id)
    if read_filter is not None:
        base = base.where(Notification.read == read_filter)

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar_one()

    result = await db.execute(
        base.order_by(Notification.created_at.desc()).offset(offset).limit(limit)
    )
    return list(result.scalars().all()), total


async def mark_read(db: AsyncSession, notification_id: str, user_id: uuid.UUID) -> Notification:
    nid = uuid.UUID(notification_id) if isinstance(notification_id, str) else notification_id
    result = await db.execute(
        select(Notification).where(Notification.id == nid, Notification.user_id == user_id)
    )
    notif = result.scalar_one_or_none()
    if not notif:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Notification not found")
    notif.read = True
    await db.flush()
    return notif


async def mark_all_read(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read.is_(False))
        .values(read=True)
    )
    await db.flush()
    return result.rowcount  # type: ignore[return-value]


async def notify_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    notification_type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    await create_notification(db, user_id, notification_type, title, body, link)


async def notify_moderators(
    db: AsyncSession,
    notification_type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    result = await db.execute(
        select(User.id).where(
            User.role.in_(MODERATOR_ROLES),
            User.deleted_at.is_(None),
        )
    )
    mod_ids = list(result.scalars().all())
    for mid in mod_ids:
        await create_notification(db, mid, notification_type, title, body, link)
