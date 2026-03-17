import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.directory import DirectoryBreadcrumb, DirectoryOut
from app.services import directory as directory_service

router = APIRouter(prefix="/api/directories", tags=["directories"])


@router.get("/{id}", response_model=DirectoryOut)
async def get_directory(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DirectoryOut:
    directory = await directory_service.get_directory_by_id(db, id)
    return DirectoryOut.model_validate(directory)


@router.get("/{id}/children")
async def get_directory_children(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    return await directory_service.get_directory_children(db, id)


@router.get("/{id}/path", response_model=list[DirectoryBreadcrumb])
async def get_directory_path(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[DirectoryBreadcrumb]:
    path = await directory_service.get_directory_path(db, id)
    return [DirectoryBreadcrumb.model_validate(p) for p in path]
