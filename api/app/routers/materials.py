import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis import get_redis
from app.dependencies.auth import CurrentUser, security
from app.dependencies.rate_limit import rate_limit_downloads
from app.models.user import User
from app.schemas.material import MaterialDetail, MaterialOut, MaterialVersionOut
from app.services.audit import record_download
from app.services.material import (
    check_material_access,
    get_material_attachments,
    get_material_version,
    get_material_versions,
    get_material_with_version,
    increment_download_count,
    record_view,
)

router = APIRouter(prefix="/api/materials", tags=["materials"])


@router.get("/{material_id}", response_model=MaterialDetail)
async def get_material(
    material_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MaterialDetail:
    data = await get_material_with_version(db, material_id)
    mat_dict = data["material"]  # already a plain dict
    if user is not None:
        check_material_access(user.id, mat_dict)
    ver = data.get("current_version_info")
    mat_out = MaterialOut.model_validate(mat_dict)
    ver_out = MaterialVersionOut.model_validate(ver) if ver else None
    return MaterialDetail.model_validate({**mat_out.model_dump(), "current_version_info": ver_out})


@router.get("/{material_id}/download-url")
async def get_material_download_url(
    material_id: str,
    request: Request,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[None, Depends(rate_limit_downloads)],
) -> dict[str, str]:
    await increment_download_count(db, material_id)
    data = await get_material_with_version(db, material_id)
    version = data.get("current_version_info")
    if version is None or version.file_key is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("No file available for download")

    await record_download(
        db,
        user.id,
        uuid.UUID(material_id),
        version.version_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    from app.core.storage import generate_presigned_get_url

    url = await generate_presigned_get_url(
        version.file_key,
        filename=version.file_name,
        content_type=version.file_mime_type,
    )
    return {"url": url}


@router.get("/{material_id}/inline")
async def inline_material(
    material_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.services.material import check_material_access, get_material_with_version

    data = await get_material_with_version(db, material_id)
    check_material_access(user.id, data)

    version = data.get("current_version_info")
    if version is None or version.file_key is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("No file available for preview")

    from app.core.storage import generate_presigned_get_url

    # Images and PDFs are safe to render inline; all other types are forced
    # to download so the browser never executes or parses unknown content.
    file_mime = getattr(version, "file_mime_type", "") or ""
    inline_safe = file_mime.startswith("image/") or file_mime == "application/pdf"
    url = await generate_presigned_get_url(
        version.file_key,
        force_download=not inline_safe,
        filename=version.file_name,
        content_type=version.file_mime_type,
    )
    return {"url": url}


@router.get("/{material_id}/file")
async def stream_material_file(
    material_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    token: Annotated[str | None, Query()] = None,
    redis: Annotated[Redis | None, Depends(get_redis)] = None,
) -> Any:
    from app.core.exceptions import NotFoundError, UnauthorizedError
    from app.services.material import check_material_access, get_material_with_version

    # Manual auth check because we want to allow either header OR query token
    effective_user: User | None = None

    # (S7/S12) Ensure redis is available for auth checks
    if redis is None:
        from app.core.redis import redis_client

        redis = redis_client

    if user is not None:  # security dependency gives HTTPAuthorizationCredentials or None
        try:
            from app.dependencies.auth import get_user_from_token

            effective_user = await get_user_from_token(db, redis, user.credentials)
        except Exception:
            pass

    if not effective_user and token:
        try:
            from app.dependencies.auth import get_user_from_token

            effective_user = await get_user_from_token(db, redis, token)
        except Exception:
            pass

    if not effective_user:
        raise UnauthorizedError()

    data = await get_material_with_version(db, material_id)
    check_material_access(effective_user.id, data)

    version = data.get("current_version_info")
    if version is None or version.file_key is None:
        raise NotFoundError("No file available")

    await record_download(
        db,
        effective_user.id,
        uuid.UUID(material_id),
        version.version_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    from app.core.storage import generate_presigned_get_url

    # Redirect to presigned URL. S3/MinIO handles Range requests (206) perfectly,
    # which is required for browser media players to seek and parse metadata.
    url = await generate_presigned_get_url(
        version.file_key,
        filename=version.file_name,
        content_type=version.file_mime_type,
    )
    return RedirectResponse(url=url, status_code=302)


@router.get("/{material_id}/versions", response_model=list[MaterialVersionOut])
async def list_versions(
    material_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[MaterialVersionOut]:
    versions = await get_material_versions(db, material_id)
    return [MaterialVersionOut.model_validate(v) for v in versions]


@router.get("/{material_id}/versions/{version_number}", response_model=MaterialVersionOut)
async def get_version(
    material_id: str,
    version_number: int,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MaterialVersionOut:
    version = await get_material_version(db, material_id, version_number)
    return MaterialVersionOut.model_validate(version)


@router.get("/{material_id}/versions/{version_number}/download-url")
async def get_version_download_url(
    material_id: str,
    version_number: int,
    request: Request,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[None, Depends(rate_limit_downloads)],
) -> dict[str, str]:
    version = await get_material_version(db, material_id, version_number)
    if not version.file_key:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("No file available for download")

    await record_download(
        db,
        user.id,
        uuid.UUID(material_id),
        version_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    from app.core.storage import generate_presigned_get_url

    url = await generate_presigned_get_url(
        version.file_key,
        filename=version.file_name,
        content_type=version.file_mime_type,
    )
    return {"url": url}


@router.get("/{material_id}/attachments", response_model=list[MaterialDetail])
async def list_attachments(
    material_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[MaterialDetail]:
    attachments = await get_material_attachments(db, material_id)
    return [MaterialDetail.model_validate(a) for a in attachments]


@router.post("/{material_id}/view")
async def view_material(
    material_id: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    await record_view(db, str(user.id), material_id)
    return {"status": "ok"}
