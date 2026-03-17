import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError
from app.models.annotation import Annotation
from app.models.comment import Comment
from app.models.flag import Flag
from app.models.material import Material
from app.models.notification import Notification
from app.models.pull_request import PRComment, PRVote, PullRequest
from app.models.user import User
from app.models.view_history import ViewHistory


async def onboard_user(
    db: AsyncSession, user: User, display_name: str, academic_year: str, gdpr_consent: bool
) -> User:
    if user.onboarded:
        raise BadRequestError("User already onboarded")
    if not gdpr_consent:
        raise BadRequestError("GDPR consent is required")

    user.display_name = display_name
    user.academic_year = academic_year
    user.gdpr_consent = True
    user.gdpr_consent_at = datetime.now(UTC)
    user.onboarded = True
    await db.flush()
    return user


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
    result = await db.execute(select(User).where(User.id == uid, User.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def get_user_stats(db: AsyncSession, user_id: str) -> dict[str, int]:
    uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
    from app.models.pull_request import PRStatus

    pr_approved = await db.scalar(
        select(func.count()).where(
            PullRequest.author_id == uid, PullRequest.status == PRStatus.APPROVED
        )
    )
    prs_total = await db.scalar(select(func.count()).where(PullRequest.author_id == uid))
    annotations_count = await db.scalar(select(func.count()).where(Annotation.author_id == uid))
    comments_count = await db.scalar(select(func.count()).where(Comment.author_id == uid))
    open_pr_count = await db.scalar(
        select(func.count()).where(
            PullRequest.author_id == uid, PullRequest.status == PRStatus.OPEN
        )
    )

    pr_approved = pr_approved or 0
    annotations_count = annotations_count or 0

    return {
        "prs_approved": pr_approved,
        "prs_total": prs_total or 0,
        "annotations_count": annotations_count,
        "comments_count": comments_count or 0,
        "open_pr_count": open_pr_count or 0,
        "reputation": pr_approved * 10 + annotations_count * 2,
    }


async def get_recently_viewed(db: AsyncSession, user_id: str, limit: int = 10) -> list[Material]:
    uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Material)
        .options(selectinload(Material.directory))
        .join(ViewHistory, ViewHistory.material_id == Material.id)
        .where(ViewHistory.user_id == uid)
        .order_by(ViewHistory.viewed_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_user_contributions(
    db: AsyncSession,
    user_id: str,
    contribution_type: str,
    limit: int,
    offset: int,
) -> tuple[list[PullRequest] | list[Material] | list[Annotation], int]:
    uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
    from sqlalchemy.orm import selectinload

    if contribution_type == "prs":
        pr_base = select(PullRequest).where(PullRequest.author_id == uid)
        count_result = await db.execute(select(func.count()).select_from(pr_base.subquery()))
        total = count_result.scalar_one()
        result = await db.execute(
            pr_base.options(selectinload(PullRequest.author))
            .order_by(PullRequest.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all()), total
    elif contribution_type == "materials":
        mat_base = select(Material).where(Material.author_id == uid)
        count_result = await db.execute(select(func.count()).select_from(mat_base.subquery()))
        total = count_result.scalar_one()
        result = await db.execute(
            mat_base.options(selectinload(Material.directory))
            .order_by(Material.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all()), total
    elif contribution_type == "annotations":
        ann_base = select(Annotation).where(Annotation.author_id == uid)
        count_result = await db.execute(select(func.count()).select_from(ann_base.subquery()))
        total = count_result.scalar_one()
        result = await db.execute(
            ann_base.options(selectinload(Annotation.author))
            .order_by(Annotation.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all()), total
    else:
        raise BadRequestError("type must be one of: prs, materials, annotations")


async def update_user_profile(
    db: AsyncSession,
    user: User,
    display_name: str | None = None,
    bio: str | None = None,
    academic_year: str | None = None,
    avatar_url: str | None = None,
) -> User:
    from app.core.minio import delete_object, move_object

    if display_name is not None:
        user.display_name = display_name
    if bio is not None:
        user.bio = bio
    if academic_year is not None:
        user.academic_year = academic_year

    if avatar_url is not None and avatar_url != user.avatar_url:
        final_url = avatar_url
        if avatar_url.startswith("uploads/"):
            # Move from uploads/ to permanent avatars/ prefix
            new_key = avatar_url.replace("uploads/", "avatars/", 1)
            await move_object(avatar_url, new_key)
            final_url = new_key

        # Delete old avatar from permanent storage if it's being replaced
        if (
            user.avatar_url
            and user.avatar_url.startswith("avatars/")
            and user.avatar_url != final_url
        ):
            await delete_object(user.avatar_url)

        user.avatar_url = final_url

    await db.flush()
    return user


async def export_user_data(db: AsyncSession, user: User) -> dict:
    uid = user.id

    prs_result = await db.execute(select(PullRequest).where(PullRequest.author_id == uid))
    prs = prs_result.scalars().all()

    annotations_result = await db.execute(select(Annotation).where(Annotation.author_id == uid))
    annotations = annotations_result.scalars().all()

    votes_result = await db.execute(select(PRVote).where(PRVote.user_id == uid))
    votes = votes_result.scalars().all()

    comments_result = await db.execute(select(Comment).where(Comment.author_id == uid))
    comments = comments_result.scalars().all()

    pr_comments_result = await db.execute(select(PRComment).where(PRComment.author_id == uid))
    pr_comments = pr_comments_result.scalars().all()

    flags_result = await db.execute(select(Flag).where(Flag.reporter_id == uid))
    flags = flags_result.scalars().all()

    notifications_result = await db.execute(select(Notification).where(Notification.user_id == uid))
    notifications = notifications_result.scalars().all()

    view_history_result = await db.execute(select(ViewHistory).where(ViewHistory.user_id == uid))
    view_history = view_history_result.scalars().all()

    return {
        "profile": {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "bio": user.bio,
            "academic_year": user.academic_year,
            "role": user.role.value,
            "avatar_url": user.avatar_url,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        },
        "consent": {
            "gdpr_consent": user.gdpr_consent,
            "gdpr_consent_at": user.gdpr_consent_at.isoformat() if user.gdpr_consent_at else None,
        },
        "pull_requests": [
            {"id": str(pr.id), "title": pr.title, "type": pr.type, "status": pr.status.value}
            for pr in prs
        ],
        "annotations": [
            {"id": str(a.id), "body": a.body, "material_id": str(a.material_id)}
            for a in annotations
        ],
        "votes": [{"id": str(v.id), "pr_id": str(v.pr_id), "value": v.value} for v in votes],
        "comments": [
            {"id": str(c.id), "body": c.body, "target_type": c.target_type} for c in comments
        ],
        "pr_comments": [
            {"id": str(pc.id), "body": pc.body, "pr_id": str(pc.pr_id)} for pc in pr_comments
        ],
        "flags": [
            {"id": str(f.id), "target_type": f.target_type, "reason": f.reason} for f in flags
        ],
        "notifications": [
            {
                "id": str(n.id),
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "read": n.read,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notifications
        ],
        "view_history": [
            {
                "id": str(vh.id),
                "material_id": str(vh.material_id),
                "viewed_at": vh.viewed_at.isoformat() if vh.viewed_at else None,
            }
            for vh in view_history
        ],
    }


async def soft_delete_user(db: AsyncSession, user: User) -> None:
    from app.core.minio import delete_object

    if user.avatar_url:
        await delete_object(user.avatar_url)

    user.deleted_at = datetime.now(UTC)
    user.display_name = "Deleted User"
    user.bio = None
    user.avatar_url = None
    user.academic_year = None
    user.gdpr_consent = False
    user.gdpr_consent_at = None
    user.onboarded = False
    await db.flush()
