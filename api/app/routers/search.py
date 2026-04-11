from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_optional_user
from app.models.user import User
from app.services.search import perform_search

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
async def search(
    query: str = Query("", min_length=0),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    user: Annotated[User | None, Depends(get_optional_user)] = None,
):
    return await perform_search(
        db,
        query,
        page=page,
        limit=limit,
        current_user_id=user.id if user else None
    )
