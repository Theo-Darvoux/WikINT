from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.directory import DirectoryBreadcrumb, DirectoryOut
from app.schemas.material import MaterialOut
from app.services.directory import (
    get_directory_by_id,
    get_directory_children,
    get_directory_path,
    get_root_directories,
    resolve_browse_path,
)

router = APIRouter(prefix="/api", tags=["browse"])


@router.get("/browse")
async def browse_root(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    roots = await get_root_directories(db)
    return {"type": "directory_listing", "directory": None, "directories": roots, "materials": []}


@router.get("/browse/{path:path}")
async def browse_path(
    path: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    result = await resolve_browse_path(db, path)

    if result["type"] == "material":
        mat_data = result["material"]
        material_dict = mat_data["material"]  # already a plain dict
        version_info = mat_data.get("current_version_info")
        mat_out = MaterialOut.model_validate(material_dict).model_dump()
        version_out = None
        if version_info:
            from app.schemas.material import MaterialVersionOut

            version_out = MaterialVersionOut.model_validate(version_info).model_dump()
        return {"type": "material", "material": {**mat_out, "current_version_info": version_out}}

    if result["type"] == "attachment_listing":
        # Materials are already plain dicts with current_version_info embedded;
        # pass them through as-is to preserve version info for the frontend.
        materials = []
        for m in result["materials"]:
            if isinstance(m, dict):
                materials.append(m)
            else:
                materials.append(MaterialOut.model_validate(m).model_dump())
        parent_mat = result.get("parent_material")
        parent_material_out = None
        if parent_mat:
            if isinstance(parent_mat, dict):
                parent_material_out = parent_mat
            else:
                parent_material_out = MaterialOut.model_validate(parent_mat).model_dump()
        return {
            "type": "attachment_listing",
            "materials": materials,
            "parent_material": parent_material_out,
        }

    directory = result.get("directory")
    breadcrumbs = []
    if directory:
        dir_out = DirectoryOut.model_validate(directory).model_dump()
        path = await get_directory_path(db, directory.id)
        breadcrumbs = [DirectoryBreadcrumb(**p).model_dump() for p in path]

    materials = []
    for m in result.get("materials", []):
        if isinstance(m, dict):
            materials.append(m)
        else:
            materials.append(MaterialOut.model_validate(m).model_dump())

    return {
        "type": "directory_listing",
        "directory": dir_out,
        "directories": result.get("directories", []),
        "materials": materials,
        "breadcrumbs": breadcrumbs,
    }


@router.get("/directories/{directory_id}")
async def get_directory(
    directory_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DirectoryOut:
    directory = await get_directory_by_id(db, directory_id)
    return DirectoryOut.model_validate(directory)


@router.get("/directories/{directory_id}/children")
async def get_children(
    directory_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    children = await get_directory_children(db, directory_id)
    materials = [MaterialOut.model_validate(m).model_dump() for m in children["materials"]]
    return {"directories": children["directories"], "materials": materials}


@router.get("/directories/{directory_id}/path")
async def get_path(
    directory_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DirectoryBreadcrumb]:
    path = await get_directory_path(db, directory_id)
    return [DirectoryBreadcrumb(**p) for p in path]
