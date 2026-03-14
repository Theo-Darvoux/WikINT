import logging
import mimetypes
from uuid import uuid4

from fastapi import APIRouter

from app.config import settings
from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.core.minio import (
    delete_object,
    generate_presigned_put,
    get_object_info,
    read_object_bytes,
    update_object_content_type,
)
from app.dependencies.auth import CurrentUser
from app.schemas.material import (
    UploadCompleteIn,
    UploadCompleteOut,
    UploadRequestIn,
    UploadRequestOut,
)

logger = logging.getLogger("wikint")

router = APIRouter(prefix="/api/upload", tags=["upload"])

MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024  # 1 GB


@router.post("/request-url", response_model=UploadRequestOut)
async def request_upload_url(
    data: UploadRequestIn,
    user: CurrentUser,
) -> UploadRequestOut:
    if data.size > MAX_FILE_SIZE:
        raise BadRequestError(f"File size exceeds maximum of {MAX_FILE_SIZE} bytes (1 GB)")

    # Sanitize filename: strip path components and null bytes
    import os
    safe_name = os.path.basename(data.filename).replace("\x00", "")
    if not safe_name:
        raise BadRequestError("Invalid filename")

    mime_type = data.mime_type
    if not mime_type or mime_type == "application/octet-stream":
        guessed_type, _ = mimetypes.guess_type(safe_name)
        mime_type = guessed_type or "application/octet-stream"

    file_key = f"uploads/{user.id}/{uuid4()}/{safe_name}"
    upload_url = await generate_presigned_put(file_key, mime_type, ttl=3600)

    return UploadRequestOut(upload_url=upload_url, file_key=file_key, mime_type=mime_type)


def guess_mime_from_bytes(data: bytes, default: str = "application/octet-stream") -> str:
    """Detect MIME type from file magic bytes. Covers all viewer-supported types."""
    if len(data) < 4:
        return default

    # PDF
    if data.startswith(b"%PDF-"):
        return "application/pdf"

    # Images
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"

    # DjVu
    if data.startswith(b"AT&TFORM"):
        return "image/vnd.djvu"

    # ZIP-based formats (OOXML, EPUB, ODF)
    if data.startswith(b"PK\x03\x04"):
        # Check for ODF/EPUB mimetype marker (stored uncompressed at offset ~30-100)
        header = data[:200]
        if b"mimetypeapplication/epub+zip" in header:
            return "application/epub+zip"
        if b"mimetypeapplication/vnd.oasis.opendocument.text" in header:
            return "application/vnd.oasis.opendocument.text"
        if b"mimetypeapplication/vnd.oasis.opendocument.spreadsheet" in header:
            return "application/vnd.oasis.opendocument.spreadsheet"
        if b"mimetypeapplication/vnd.oasis.opendocument.presentation" in header:
            return "application/vnd.oasis.opendocument.presentation"
        # OOXML: look for content type markers in [Content_Types].xml
        if b"word/" in data[:2048]:
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if b"xl/" in data[:2048]:
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if b"ppt/" in data[:2048]:
            return "application/vnd.openxmlformats-officedocument.presentationml.presentation"

    # Legacy MS Office (OLE2 Compound Binary)
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        # Can't easily distinguish doc/xls/ppt from header alone; default to doc
        return "application/msword"

    return default


@router.post("/complete", response_model=UploadCompleteOut)
async def complete_upload(
    data: UploadCompleteIn,
    user: CurrentUser,
) -> UploadCompleteOut:
    expected_prefix = f"uploads/{user.id}/"
    if not data.file_key.startswith(expected_prefix):
        raise BadRequestError("Invalid file key")

    try:
        obj_info = await get_object_info(data.file_key)
    except Exception:
        raise BadRequestError("File not found in storage")

    mime_type = obj_info.get("content_type", "application/octet-stream")
    if not mime_type or mime_type == "application/octet-stream":
        header_bytes = await read_object_bytes(data.file_key, 2048)
        real_mime = guess_mime_from_bytes(header_bytes, mime_type)
        if real_mime != "application/octet-stream":
            await update_object_content_type(data.file_key, real_mime)
            obj_info["content_type"] = real_mime

    scan_ok = await _scan_file(data.file_key, obj_info["size"])

    if not scan_ok:
        await delete_object(data.file_key)
        raise BadRequestError("File failed virus scan")

    return UploadCompleteOut(
        file_key=data.file_key,
        size=obj_info["size"],
        mime_type=obj_info["content_type"],
    )


async def _scan_file(file_key: str, file_size: int) -> bool:
    try:
        import aioclamd

        timeout = settings.clamav_scan_timeout_base + int(
            settings.clamav_scan_timeout_per_gb * file_size / (1024 * 1024 * 1024)
        )
        cd = aioclamd.ClamdAsyncClient(settings.clamav_host, settings.clamav_port, timeout=timeout)
        result = await cd.scan(f"/data/{settings.minio_bucket}/{file_key}")
        if result is None:
            return True
        for path, (status, _reason) in result.items():
            if status != "OK":
                logger.warning("ClamAV detected threat in %s: %s", file_key, _reason)
                return False
        return True
    except ImportError:
        logger.warning("aioclamd not installed, skipping virus scan")
        return True
    except (ConnectionRefusedError, OSError, TimeoutError) as e:
        logger.error("ClamAV unavailable: %s", e)
        await delete_object(file_key)
        raise ServiceUnavailableError("Virus scanner unavailable — file rejected (fail-closed)")
