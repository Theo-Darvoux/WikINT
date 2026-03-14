from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import CurrentUser
from app.schemas.material import MaterialDetail, MaterialOut, MaterialVersionOut
from app.services.material import (
    get_material_attachments,
    get_material_version,
    get_material_versions,
    get_material_with_version,
    increment_download_count,
    material_orm_to_dict,
    record_view,
)

router = APIRouter(prefix="/api/materials", tags=["materials"])


@router.get("/{material_id}", response_model=MaterialDetail)
async def get_material(
    material_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MaterialDetail:
    data = await get_material_with_version(db, material_id)
    mat_dict = data["material"]  # already a plain dict
    ver = data.get("current_version_info")
    mat_out = MaterialOut.model_validate(mat_dict)
    ver_out = MaterialVersionOut.model_validate(ver) if ver else None
    return MaterialDetail(**mat_out.model_dump(), current_version_info=ver_out)


@router.get("/{material_id}/download")
async def download_material(
    material_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RedirectResponse:
    await increment_download_count(db, material_id)
    data = await get_material_with_version(db, material_id)
    version = data.get("current_version_info")
    if not version or not version.file_key:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("No file available for download")

    from app.core.minio import generate_presigned_get_url

    url = await generate_presigned_get_url(version.file_key)
    return RedirectResponse(url=url, status_code=302)


@router.get("/{material_id}/inline")
async def inline_material(
    material_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RedirectResponse:
    data = await get_material_with_version(db, material_id)
    version = data.get("current_version_info")
    if not version or not version.file_key:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("No file available for preview")

    from app.core.minio import generate_presigned_get_url

    url = await generate_presigned_get_url(version.file_key)
    return RedirectResponse(url=url, status_code=302)


@router.get("/{material_id}/file")
async def stream_material_file(
    material_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    from fastapi.responses import Response

    from app.config import settings
    from app.core.minio import get_s3_client

    data = await get_material_with_version(db, material_id)
    version = data.get("current_version_info")
    if not version or not version.file_key:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("No file available")

    async with get_s3_client() as s3:
        s3_response = await s3.get_object(
            Bucket=settings.minio_bucket,
            Key=version.file_key,
        )
        content = await s3_response["Body"].read()

    return Response(
        content=content,
        media_type=version.file_mime_type or "application/octet-stream",
        headers={"Content-Disposition": "inline"},
    )


@router.get("/{material_id}/versions", response_model=list[MaterialVersionOut])
async def list_versions(
    material_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[MaterialVersionOut]:
    versions = await get_material_versions(db, material_id)
    return [MaterialVersionOut.model_validate(v) for v in versions]


@router.get("/{material_id}/versions/{version_number}", response_model=MaterialVersionOut)
async def get_version(
    material_id: str,
    version_number: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MaterialVersionOut:
    version = await get_material_version(db, material_id, version_number)
    return MaterialVersionOut.model_validate(version)


@router.get("/{material_id}/versions/{version_number}/download")
async def download_version(
    material_id: str,
    version_number: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RedirectResponse:
    version = await get_material_version(db, material_id, version_number)
    if not version.file_key:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("No file available for download")

    from app.core.minio import generate_presigned_get_url

    url = await generate_presigned_get_url(version.file_key)
    return RedirectResponse(url=url, status_code=302)


@router.get("/{material_id}/attachments", response_model=list[MaterialOut])
async def list_attachments(
    material_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[MaterialOut]:
    attachments = await get_material_attachments(db, material_id)
    return [MaterialOut.model_validate(material_orm_to_dict(a)) for a in attachments]


@router.post("/{material_id}/view")
async def view_material(
    material_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    await record_view(db, str(user.id), material_id)
    return {"status": "ok"}
