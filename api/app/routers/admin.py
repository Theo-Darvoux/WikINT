import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequestError, NotFoundError
from app.dependencies.auth import require_moderator, require_role
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
    user_count = await db.scalar(
        select(func.count()).select_from(User).where(User.deleted_at.is_(None))
    ) or 0
    material_count = await db.scalar(select(func.count()).select_from(Material)) or 0
    open_pr_count = await db.scalar(
        select(func.count()).select_from(PullRequest).where(PullRequest.status == PRStatus.OPEN)
    ) or 0
    open_flag_count = await db.scalar(
        select(func.count()).select_from(Flag).where(Flag.status == "open")
    ) or 0
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
        base = base.where(
            User.email.ilike(pattern) | User.display_name.ilike(pattern)
        )

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
                "created_at": u.created_at.isoformat() if u.created_at else None,
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
    _user: Annotated[User, Depends(require_role(UserRole.BUREAU, UserRole.VIEUX))] = None,  # type: ignore[assignment]
    db: Annotated[AsyncSession, Depends(get_db)] = None,  # type: ignore[assignment]
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
    _user: Annotated[User, Depends(require_role(UserRole.BUREAU, UserRole.VIEUX))] = None,  # type: ignore[assignment]
    db: Annotated[AsyncSession, Depends(get_db)] = None,  # type: ignore[assignment]
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
    result = await db.execute(
        select(Directory).order_by(Directory.sort_order, Directory.name)
    )
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
