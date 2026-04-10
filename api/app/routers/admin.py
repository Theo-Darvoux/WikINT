import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequestError, NotFoundError
from app.dependencies.auth import require_moderator, require_role
from app.models.dead_letter import DeadLetterJob
from app.models.directory import Directory
from app.models.flag import Flag
from app.models.material import Material
from app.models.pull_request import PRStatus, PullRequest
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_ROLES = (UserRole.BUREAU, UserRole.VIEUX)


@router.get("/stats")
async def admin_stats(
    _user: Annotated[User, Depends(require_moderator())],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    user_count = (
        await db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None)))
        or 0
    )
    material_count = await db.scalar(select(func.count()).select_from(Material)) or 0
    open_pr_count = (
        await db.scalar(
            select(func.count()).select_from(PullRequest).where(PullRequest.status == PRStatus.OPEN)
        )
        or 0
    )
    open_flag_count = (
        await db.scalar(select(func.count()).select_from(Flag).where(Flag.status == "open")) or 0
    )
    return {
        "user_count": user_count,
        "material_count": material_count,
        "open_pr_count": open_pr_count,
        "open_flag_count": open_flag_count,
    }


@router.get("/users")
async def admin_list_users(
    _user: Annotated[User, Depends(require_moderator())],
    db: Annotated[AsyncSession, Depends(get_db)],
    role: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
) -> dict:
    base = select(User).where(User.deleted_at.is_(None))
    if role:
        base = base.where(User.role == role)
    if search:
        pattern = f"%{search}%"
        base = base.where(User.email.ilike(pattern) | User.display_name.ilike(pattern))

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar_one()

    result = await db.execute(
        base.order_by(User.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )
    users = result.scalars().all()
    return {
        "items": [
            {
                "id": str(u.id),
                "email": u.email,
                "display_name": u.display_name,
                "role": u.role.value if u.role else None,
                "onboarded": u.onboarded,
                "created_at": u.created_at.isoformat() if u.created_at is not None else None,
            }
            for u in users
        ],
        "total": total,
        "page": page,
        "pages": max(1, (total + limit - 1) // limit),
    }


@router.patch("/users/{user_id}/role")
async def admin_update_role(
    user_id: uuid.UUID,
    role: str = Query(...),
    _user: Annotated[User | None, Depends(require_role(UserRole.BUREAU, UserRole.VIEUX))] = None,
    db: Annotated[AsyncSession | None, Depends(get_db)] = None,
) -> dict:
    target = await db.scalar(select(User).where(User.id == user_id))
    if not target:
        raise NotFoundError("User not found")
    try:
        new_role = UserRole(role)
    except ValueError:
        raise BadRequestError(f"Invalid role: {role}")
    target.role = new_role
    await db.flush()
    return {"status": "ok", "role": new_role.value}


@router.delete("/users/{user_id}")
async def admin_delete_user(
    user_id: uuid.UUID,
    _user: Annotated[User | None, Depends(require_role(UserRole.BUREAU, UserRole.VIEUX))] = None,
    db: Annotated[AsyncSession | None, Depends(get_db)] = None,
) -> dict:
    from datetime import UTC, datetime

    target = await db.scalar(select(User).where(User.id == user_id))
    if not target:
        raise NotFoundError("User not found")
    target.deleted_at = datetime.now(UTC)
    await db.flush()
    return {"status": "ok"}


@router.get("/directories")
async def admin_list_directories(
    _user: Annotated[User, Depends(require_moderator())],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    result = await db.execute(select(Directory).order_by(Directory.sort_order, Directory.name))
    dirs = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "slug": d.slug,
            "type": d.type.value if d.type else None,
            "parent_id": str(d.parent_id) if d.parent_id else None,
            "is_system": d.is_system,
        }
        for d in dirs
    ]


# ── Dead Letter Queue endpoints ─────────────────────────────────────────────


@router.get("/dlq")
async def list_dead_letter_jobs(
    _user: Annotated[User, Depends(require_role(UserRole.BUREAU, UserRole.VIEUX))],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    resolved: bool = Query(False),
) -> dict:
    """List dead letter jobs, paginated. By default shows unresolved jobs only."""
    base = select(DeadLetterJob)
    if not resolved:
        base = base.where(DeadLetterJob.resolved_at.is_(None))

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar_one()

    result = await db.execute(
        base.order_by(DeadLetterJob.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )
    jobs = result.scalars().all()
    return {
        "items": [
            {
                "id": str(j.id),
                "job_name": j.job_name,
                "upload_id": j.upload_id,
                "payload": j.payload,
                "error_detail": j.error_detail,
                "attempts": j.attempts,
                "created_at": j.created_at.isoformat() if j.created_at is not None else None,
                "resolved_at": j.resolved_at.isoformat() if j.resolved_at else None,
            }
            for j in jobs
        ],
        "total": total,
        "page": page,
        "pages": max(1, (total + limit - 1) // limit),
    }


@router.post("/dlq/{job_id}/retry")
async def retry_dead_letter_job(
    job_id: uuid.UUID,
    _user: Annotated[User, Depends(require_role(UserRole.BUREAU, UserRole.VIEUX))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Re-enqueue a dead letter job for processing."""
    job = await db.scalar(select(DeadLetterJob).where(DeadLetterJob.id == job_id))
    if not job:
        raise NotFoundError("Dead letter job not found")
    if job.resolved_at is not None:
        raise BadRequestError("Job has already been resolved")

    import app.core.redis as redis_core

    if redis_core.arq_pool is None:
        raise BadRequestError("Background job queue is unavailable")

    # Re-enqueue with the original payload
    payload = job.payload or {}
    await redis_core.arq_pool.enqueue_job(
        job.job_name,
        **payload,
    )

    # Mark as resolved (the new job will create a new DLQ entry if it fails again)
    job.resolved_at = datetime.now(UTC)
    await db.flush()

    return {"status": "ok", "message": "Job re-enqueued"}


@router.post("/dlq/{job_id}/dismiss")
async def dismiss_dead_letter_job(
    job_id: uuid.UUID,
    _user: Annotated[User, Depends(require_role(UserRole.BUREAU, UserRole.VIEUX))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Mark a dead letter job as resolved without retrying."""
    job = await db.scalar(select(DeadLetterJob).where(DeadLetterJob.id == job_id))
    if not job:
        raise NotFoundError("Dead letter job not found")
    if job.resolved_at is not None:
        raise BadRequestError("Job has already been resolved")

    job.resolved_at = datetime.now(UTC)
    await db.flush()

    return {"status": "ok", "message": "Job dismissed"}
