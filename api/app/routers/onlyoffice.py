import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.database import get_db
from app.core.redis import get_redis
from app.dependencies.auth import CurrentUser

router = APIRouter(prefix="/api/onlyoffice", tags=["onlyoffice"])

# Maps file extensions to ONLYOFFICE documentType
_EXT_TO_DOCTYPE: dict[str, str] = {
    "docx": "word",
    "doc": "word",
    "odt": "word",
    "xlsx": "cell",
    "xls": "cell",
    "ods": "cell",
    "pptx": "slide",
    "ppt": "slide",
}

_ALGORITHM = "HS256"


async def _create_file_token_async(material_id: str, redis: Redis) -> str:
    """Create a short-lived JWT for ONLYOFFICE to fetch a specific file."""
    expire = datetime.now(UTC) + timedelta(seconds=settings.onlyoffice_file_token_ttl)
    jti = secrets.token_hex(16)
    payload = {
        "sub": material_id,
        "type": "onlyoffice_file",
        "exp": expire,
        "jti": jti,
    }
    await redis.set(f"onlyoffice:jti:{jti}", "1", ex=settings.onlyoffice_file_token_ttl)
    return jwt.encode(payload, settings.onlyoffice_file_token_secret, algorithm=_ALGORITHM)


def _verify_file_token_claims(token: str, material_id: str) -> str | None:
    """Validate JWT signature and claims. Returns jti on success, None on failure."""
    try:
        payload = jwt.decode(
            token,
            settings.onlyoffice_file_token_secret,
            algorithms=[_ALGORITHM],
        )
        jti = payload.get("jti")
        if not jti:
            return None
        if payload.get("sub") != material_id or payload.get("type") != "onlyoffice_file":
            return None
        return jti
    except jwt.PyJWTError:
        return None


async def _verify_file_token_async(token: str, material_id: str, redis: Redis) -> bool:
    """Validate a file-access JWT and consume the single-use JTI via Redis."""
    jti = _verify_file_token_claims(token, material_id)
    if not jti:
        return False
    # Atomically delete the token. If it returns 0, it was already consumed or expired.
    deleted = await redis.delete(f"onlyoffice:jti:{jti}")
    return bool(deleted)


@router.get("/config/{material_id}")
async def get_onlyoffice_config(
    material_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> dict:
    """
    Return a signed ONLYOFFICE editor configuration for the given material.
    Called by the frontend (authenticated with user JWT).
    """
    from app.core.exceptions import NotFoundError
    from app.services.material import check_material_access, get_material_with_version

    material_id = str(material_id)
    data = await get_material_with_version(db, material_id)
    material_obj = data.get("material")
    if material_obj and user:
        check_material_access(user.id, material_obj)
    version = data.get("current_version_info")
    if not version or not version.file_key:
        raise NotFoundError("No file available for preview")

    file_name: str = version.file_name or ""
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    doc_type = _EXT_TO_DOCTYPE.get(ext, "word")

    # Short-lived token for ONLYOFFICE to fetch the file via the internal API.
    # Embedded in the query string because ONLYOFFICE's file downloader does not
    # forward custom requestHeaders — it only sends its own JWT.  This is an
    # internal container-to-container URL, never exposed to the browser.
    file_token = await _create_file_token_async(material_id, redis)
    file_url = f"{settings.onlyoffice_internal_api_base_url}/api/onlyoffice/file/{material_id}?token={file_token}"

    # Cache key: version_number invalidates on new uploads.
    doc_key = f"{material_id}-v{version.version_number}"
    if settings.is_dev:
        # Dev-only: bust OO's cache without uploading a new version.
        # Remove this when iterating on config changes is no longer needed.
        doc_key += f"-{secrets.token_hex(4)}"

    config: dict = {
        "documentType": doc_type,
        "document": {
            "fileType": ext,
            "key": doc_key,
            "title": file_name,
            "url": file_url,
            "permissions": {
                "edit": False,
                "download": False,
                # print: True — students can print or export to PDF via OO's menu.
                # Intentional trade-off: "download: false" blocks direct file download but
                # cannot prevent print-to-PDF. To enforce full exfiltration prevention,
                # set print: False and remove the print affordance from the frontend.
                "print": True,
                "comment": False,
                "review": False,
                "fillForms": False,
                "modifyContentControl": False,
                "modifyFilter": False,
            },
        },
        "editorConfig": {
            "mode": "view",
            "lang": "en",
            "customization": {
                "compactHeader": True,
                "hideRightMenu": True,
                "toolbarNoTabs": True,
                "chat": False,
                "comments": False,
                "help": False,
                "plugins": False,
                "toolbarHideFileName": True,
                "anonymous": {"request": False},
            },
        },
    }

    # Sign the entire config — ONLYOFFICE validates this token before rendering
    config["token"] = jwt.encode(config, settings.onlyoffice_jwt_secret, algorithm=_ALGORITHM)

    return config


@router.api_route("/file/{material_id}", methods=["GET", "HEAD"])
async def serve_file_to_onlyoffice(
    request: Request,
    material_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> Response:
    """
    Serve the raw file bytes to ONLYOFFICE Document Server.
    Called internally by ONLYOFFICE (not the browser).
    Authenticated via a short-lived scoped JWT passed as ?token= query param
    (fallback: X-OO-File-Token header).

    ONLYOFFICE probes the URL with HEAD before downloading — both methods
    must return 2xx or it reports errorCode: -4 "Download failed".
    """
    from app.core.exceptions import NotFoundError, UnauthorizedError
    from app.services.material import get_material_file_info

    material_id = str(material_id)
    token = request.query_params.get("token") or request.headers.get("X-OO-File-Token")
    if not token:
        raise UnauthorizedError()

    if request.method == "HEAD":
        # HEAD is ONLYOFFICE's preflight probe — verify the token is valid but do NOT
        # consume the JTI. The subsequent GET will consume it.
        if not _verify_file_token_claims(token, material_id):
            raise UnauthorizedError()
    else:
        # GET: validate and consume the JTI atomically (single-use enforcement).
        if not await _verify_file_token_async(token, material_id, redis):
            raise UnauthorizedError()

    version = await get_material_file_info(db, material_id)
    if not version or not version.file_key:
        raise NotFoundError("No file available")

    file_name: str = version.file_name or "document"
    mime_type: str = version.file_mime_type or "application/octet-stream"

    from urllib.parse import quote

    ascii_safe = (
        file_name.encode("ascii", errors="replace")
        .decode("ascii")
        .replace('"', "_")
        .replace("\r", "")
        .replace("\n", "")
    )
    encoded = quote(file_name, safe="")

    headers = {
        "Content-Disposition": f"attachment; filename=\"{ascii_safe}\"; filename*=UTF-8''{encoded}",
        "Content-Length": str(version.file_size or 0),
    }

    if request.method == "HEAD":
        # Content-Length intentionally omitted: HEAD is only used by OO to verify
        # URL reachability. A stale DB value would cause errorCode: -4.
        return Response(media_type=mime_type)

    from app.core.storage import stream_object

    async def _iter_file(key: str) -> AsyncIterator[bytes]:
        async with stream_object(key) as body:
            chunk = await body.read(65536)
            while chunk:
                yield chunk
                chunk = await body.read(65536)

    # Content-Length is included: file_size is set at upload time and is
    # immutable, so it is always accurate.  Having it lets nginx buffer the
    # transfer efficiently and ONLYOFFICE detect download completion.
    return StreamingResponse(_iter_file(version.file_key), media_type=mime_type, headers=headers)
