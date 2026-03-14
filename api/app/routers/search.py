from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.dependencies.auth import get_current_user
from app.models.user import User
from app.services.search import perform_search

router = APIRouter(prefix="/api/search", tags=["search"])

@router.get("")
async def global_search(
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    current_user: Annotated[User, Depends(get_current_user)] = None
):
    results = await perform_search(query=q, page=page, limit=limit)
    return results
