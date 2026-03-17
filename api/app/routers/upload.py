import json
import logging
import mimetypes
import os
import re
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends
from redis.asyncio import Redis

from app.config import settings
from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.core.file_security import strip_metadata
from app.core.minio import (
    delete_object,
    generate_presigned_put,
    get_object_info,
    get_s3_client,
    move_object,
    read_full_object,
    read_object_bytes,
    stream_object,
    update_object_content_type,
)
from app.core.redis import get_redis
from app.dependencies.auth import CurrentUser
from app.dependencies.rate_limit import rate_limit_uploads
from app.schemas.material import (
    UploadCompleteIn,
    UploadCompleteOut,
    UploadRequestIn,
    UploadRequestOut,
)

logger = logging.getLogger("wikint")

router = APIRouter(prefix="/api/upload", tags=["upload"])

MAX_PENDING_UPLOADS = 50
LARGE_FILE_THRESHOLD = 50 * 1024 * 1024  # 50 MB

# Allowed file extensions — matches viewer-supported types
ALLOWED_EXTENSIONS = {
    # Documents
    ".pdf",
    ".epub",
    ".djvu",
    ".djv",
    # Images
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    # Audio
    ".mp3",
    ".wav",
    ".ogg",
    ".flac",
    ".aac",
    ".m4a",
    # Video
    ".mp4",
    ".webm",
    # Office (modern + legacy + ODF)
    ".docx",
    ".xlsx",
    ".pptx",
    ".doc",
    ".xls",
    ".ppt",
    ".odt",
    ".ods",
    # Text / code
    ".md",
    ".markdown",
    ".txt",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".tex",
    ".latex",
    ".log",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".py",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".rs",
    ".go",
    ".rb",
    ".php",
    ".cs",
    ".swift",
    ".kt",
    ".scala",
    ".css",
    ".scss",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".lua",
    ".r",
    ".m",
    ".ml",
    ".hs",
    ".ex",
    ".exs",
    ".clj",
}

# Patterns that indicate dangerous SVG content (XSS vectors).
# Checked against lowercased file bytes.
_SVG_DANGEROUS_PATTERNS = [
    b"<script",
    b"<foreignobject",
    b"javascript:",
    b"vbscript:",
    b"data:text/html",
    b"<iframe",
    b"<embed",
    b"<object",
]
_SVG_EVENT_HANDLER_RE = re.compile(rb"\bon\w+\s*=", re.IGNORECASE)


@router.post("/request-url", response_model=UploadRequestOut)
async def request_upload_url(
    data: UploadRequestIn,
    user: CurrentUser,
    _: Annotated[None, Depends(rate_limit_uploads)],
) -> UploadRequestOut:
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if data.size > max_bytes:
        raise BadRequestError(f"File size exceeds maximum of {settings.max_file_size_mb} MiB")

    # Cap pending uploads per user
    if user.role not in ("member", "bureau", "vieux"):
        async with get_s3_client() as s3:
            paginator = s3.get_paginator("list_objects_v2")
            count = 0
            async for page in paginator.paginate(
                Bucket=settings.minio_bucket,
                Prefix=f"uploads/{user.id}/",
            ):
                count += len(page.get("Contents", []))
                if count >= MAX_PENDING_UPLOADS:
                    break
            if count >= MAX_PENDING_UPLOADS:
                raise BadRequestError(
                    f"Too many pending uploads ({MAX_PENDING_UPLOADS} max). "
                    "Complete or wait for existing uploads to expire before uploading more."
                )

    # Sanitize filename
    safe_name = os.path.basename(data.filename)
    # Strip control characters (U+0000–U+001F, U+007F)
    safe_name = re.sub(r"[\x00-\x1f\x7f]", "", safe_name)
    # Strip Unicode bidirectional overrides and zero-width characters
    safe_name = re.sub(r"[\u200b-\u200f\u2028-\u202f\u2060\ufeff]", "", safe_name)
    # Replace spaces and URL-unsafe characters with underscores
    safe_name = re.sub(r"[\s#%&{}\\<>*?/$!'\":@+`|=^~\[\]]", "_", safe_name)
    # Collapse consecutive underscores and strip leading/trailing underscores
    safe_name = re.sub(r"_+", "_", safe_name).strip("_.")
    if not safe_name:
        raise BadRequestError("Invalid filename")

    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise BadRequestError(f"File type '{ext}' is not supported")

    mime_type: str | None = data.mime_type
    if not mime_type or mime_type == "application/octet-stream":
        guessed_type, _encoding = mimetypes.guess_type(safe_name)
        mime_type = guessed_type or "application/octet-stream"

    file_key = f"uploads/{user.id}/{uuid4()}/{safe_name}"
    upload_url = await generate_presigned_put(
        file_key, mime_type, ttl=3600, content_length=data.size
    )

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

    # SVG (look for <svg)
    if b"<svg" in data.lower():
        return "image/svg+xml"

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

    # Audio formats
    if data.startswith(b"ID3") or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if data.startswith(b"fLaC"):
        return "audio/flac"
    if data.startswith(b"OggS"):
        return "audio/ogg"
    if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WAVE":
        return "audio/wav"
    if len(data) >= 8 and data[4:8] == b"ftyp":
        # MP4/M4A container — check brand to distinguish audio from video
        brand = data[8:12] if len(data) >= 12 else b""
        if brand in (b"M4A ", b"M4B "):
            # Explicitly audio-only brands
            return "audio/mp4"
        # isom, mp42, avc1, etc. are generic MP4/video brands
        return "video/mp4"

    # Legacy MS Office (OLE2 Compound Binary)
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        # Can't easily distinguish doc/xls/ppt from header alone; default to doc
        return "application/msword"

    return default


# Whitelist of trusted extension -> MIME mappings
EXTENSION_MAPPING = {
    ".pdf": ["application/pdf"],
    ".png": ["image/png"],
    ".jpg": ["image/jpeg"],
    ".jpeg": ["image/jpeg"],
    ".gif": ["image/gif"],
    ".webp": ["image/webp"],
    ".svg": ["image/svg+xml"],
    ".mp3": ["audio/mpeg", "audio/mp3"],
    ".wav": ["audio/wav", "audio/x-wav"],
    ".ogg": ["audio/ogg", "video/ogg"],
    ".flac": ["audio/flac", "audio/x-flac"],
    ".aac": ["audio/aac", "audio/x-aac"],
    ".m4a": ["audio/mp4", "audio/x-m4a"],
    ".mp4": ["video/mp4"],
    ".webm": ["video/webm"],
    ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ".epub": ["application/epub+zip"],
    ".djvu": ["image/vnd.djvu"],
    ".djv": ["image/vnd.djvu"],
}

# Reverse mapping: MIME type -> canonical extension (used to fix mismatched filenames)
MIME_TO_EXTENSION: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/vnd.djvu": ".djvu",
    "audio/mpeg": ".mp3",
    "audio/flac": ".flac",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "application/epub+zip": ".epub",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/msword": ".doc",
}


def _check_svg_safety(file_bytes: bytes, file_key: str) -> None:
    """Reject SVGs containing any XSS vector: scripts, event handlers, dangerous URIs.

    Decodes from multiple encodings and unescapes HTML entities before matching,
    so encoded payloads like &#x3C;script> are caught.
    """
    import html as html_mod

    decoded = ""
    for enc in ("utf-8", "utf-16", "utf-16-le", "utf-16-be", "latin-1"):
        try:
            decoded = file_bytes.decode(enc)
            break
        except (UnicodeDecodeError, ValueError):
            continue
    decoded = html_mod.unescape(decoded).lower()
    content = decoded.encode("utf-8")

    for pattern in _SVG_DANGEROUS_PATTERNS:
        if pattern in content:
            logger.warning("Security: SVG dangerous pattern %r in %s", pattern.decode(), file_key)
            raise BadRequestError("SVG files containing scripts or active content are not allowed.")
    if _SVG_EVENT_HANDLER_RE.search(content):
        logger.warning("Security: SVG event handler in %s", file_key)
        raise BadRequestError("SVG files containing event handler attributes are not allowed.")


# Redis key prefix for completed scan results — prevents re-scanning and
# provides idempotent responses for retried complete_upload calls.
_SCAN_CACHE_PREFIX = "upload:scanned:"
_SCAN_CACHE_TTL = 3600  # 1 hour — matches presigned URL TTL


@router.post("/complete", response_model=UploadCompleteOut)
async def complete_upload(
    data: UploadCompleteIn,
    user: CurrentUser,
    redis: Annotated[Redis, Depends(get_redis)],
    _: Annotated[None, Depends(rate_limit_uploads)],
) -> UploadCompleteOut:
    expected_prefix = f"uploads/{user.id}/"
    if not data.file_key.startswith(expected_prefix):
        raise BadRequestError("Invalid file key")

    # Return cached result if this file was already scanned clean.
    # Prevents ClamAV re-scanning and makes retries idempotent.
    cache_key = f"{_SCAN_CACHE_PREFIX}{data.file_key}"
    cached = await redis.get(cache_key)
    if cached:
        result = json.loads(cached)
        return UploadCompleteOut(**result)

    try:
        obj_info = await get_object_info(data.file_key)
    except Exception:
        raise BadRequestError("File not found in storage")

    mime_type = obj_info.get("content_type", "application/octet-stream")
    file_size = obj_info["size"]

    # Enforce size limit on the actual uploaded object (declared size is validated
    # at request-url, but the presigned PUT to MinIO doesn't enforce it)
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if file_size > max_bytes:
        await delete_object(data.file_key)
        raise BadRequestError(
            f"Uploaded file exceeds maximum size of {settings.max_file_size_mb} MiB"
        )

    ext = os.path.splitext(data.file_key)[1].lower()

    # MIME detection from first 2048 bytes (does not require loading full file)
    header_bytes = await read_object_bytes(data.file_key, 2048)
    real_mime = guess_mime_from_bytes(header_bytes, "application/octet-stream")

    file_key = data.file_key

    if real_mime != "application/octet-stream":
        allowed_mimes = EXTENSION_MAPPING.get(ext, [])
        if allowed_mimes and real_mime not in allowed_mimes:
            # Extension doesn't match actual content — fix the extension instead of rejecting
            correct_ext = MIME_TO_EXTENSION.get(real_mime)
            if correct_ext:
                stem = os.path.splitext(file_key)[0]
                new_key = stem + correct_ext
                logger.warning(
                    "Extension mismatch: renaming %s -> %s (detected: %s)",
                    file_key,
                    new_key,
                    real_mime,
                )
                await move_object(file_key, new_key)
                file_key = new_key
                ext = correct_ext
            else:
                logger.warning(
                    "Extension mismatch with no known correction. Key: %s, Detected: %s, Extension: %s",
                    file_key,
                    real_mime,
                    ext,
                )

    # Establish an authoritative server-side MIME type
    authoritative_mime: str | None = real_mime
    if authoritative_mime == "application/octet-stream":
        # Fallback to extension-based MIME for text/csv/json/code formats that lack magic bytes
        guessed, _encoding = mimetypes.guess_type(file_key)
        authoritative_mime = guessed or "application/octet-stream"

    # Unconditionally overwrite the MinIO content type if it differs from our calculation.
    # This strips any malicious Content-Type the client injected during the presigned upload.
    if authoritative_mime and mime_type != authoritative_mime:
        await update_object_content_type(file_key, authoritative_mime)
        obj_info["content_type"] = authoritative_mime

    # SVGs must stay under the small-file threshold so _check_svg_safety always runs
    if obj_info["content_type"] == "image/svg+xml" and file_size > LARGE_FILE_THRESHOLD:
        await delete_object(file_key)
        raise BadRequestError(
            f"SVG files must be under {LARGE_FILE_THRESHOLD // (1024 * 1024)} MiB"
        )

    try:
        if file_size <= LARGE_FILE_THRESHOLD:
            # Small file path: load into memory for SVG check, metadata stripping, and in-memory scan
            file_bytes = await read_full_object(file_key)

            if obj_info["content_type"] == "image/svg+xml":
                try:
                    _check_svg_safety(file_bytes, file_key)
                except BadRequestError:
                    await delete_object(file_key)
                    raise

            clean_bytes = strip_metadata(file_bytes, obj_info["content_type"])
            if len(clean_bytes) != len(file_bytes):
                logger.info(
                    "Metadata stripped from %s (mime: %s)", file_key, obj_info["content_type"]
                )
                async with get_s3_client() as s3:
                    await s3.put_object(
                        Bucket=settings.minio_bucket,
                        Key=file_key,
                        Body=clean_bytes,
                        ContentType=obj_info["content_type"],
                    )
                file_bytes = clean_bytes
                file_size = len(clean_bytes)

            await _scan_instream(file_key, file_bytes, file_size)
        else:
            # Large file path: stream directly from S3 to ClamAV without loading into memory
            await _scan_instream_streaming(file_key, file_size)
    except BadRequestError:
        # Virus found (or other scan failure) -> delete
        await delete_object(file_key)
        raise

    result = UploadCompleteOut(
        file_key=file_key,
        size=file_size,
        mime_type=obj_info["content_type"],
    )

    # Cache the scan result so repeated calls return immediately
    await redis.set(
        cache_key,
        json.dumps(result.model_dump()),
        ex=_SCAN_CACHE_TTL,
    )
    # If the file was renamed (extension correction), also cache under the new key
    # so a retry with the original key AND the corrected key both hit cache
    if file_key != data.file_key:
        new_cache_key = f"{_SCAN_CACHE_PREFIX}{file_key}"
        await redis.set(
            new_cache_key,
            json.dumps(result.model_dump()),
            ex=_SCAN_CACHE_TTL,
        )

    return result


CLAMAV_CHUNK_SIZE = 8192


async def _scan_instream(file_key: str, file_bytes: bytes, file_size: int) -> None:
    """Stream file bytes to ClamAV via the INSTREAM protocol. Zero dependencies.

    Protocol: open TCP → send "zINSTREAM\\0" → send chunks as
    [4-byte big-endian length][data] → send 4 zero bytes → read response line.
    Response is "stream: OK" or "stream: <threat> FOUND".
    """
    import asyncio
    import struct

    timeout = settings.clamav_scan_timeout_base + int(
        settings.clamav_scan_timeout_per_gb * file_size / (1024 * 1024 * 1024)
    )

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(settings.clamav_host, settings.clamav_port),
            timeout=10,
        )
    except (ConnectionRefusedError, OSError, TimeoutError) as e:
        logger.error("ClamAV unavailable: %s", e)
        raise ServiceUnavailableError("Virus scanner unavailable — file rejected (fail-closed)")

    try:
        # Send INSTREAM command (newline-terminated mode for newline-terminated response)
        writer.write(b"nINSTREAM\n")

        # Send file data in chunks
        offset = 0
        while offset < len(file_bytes):
            chunk = file_bytes[offset : offset + CLAMAV_CHUNK_SIZE]
            writer.write(struct.pack(">I", len(chunk)) + chunk)
            offset += len(chunk)

        # End-of-stream marker
        writer.write(struct.pack(">I", 0))
        await writer.drain()

        # Read response (newline-terminated)
        response = await asyncio.wait_for(reader.readline(), timeout=timeout)
        response_text = response.decode("utf-8", errors="replace").strip()
    except (OSError, TimeoutError) as e:
        logger.error("ClamAV communication error: %s", e)
        raise ServiceUnavailableError("Virus scanner error — file rejected (fail-closed)")
    finally:
        writer.close()
        await writer.wait_closed()

    # Parse response: "stream: OK" or "stream: <name> FOUND"
    if response_text.endswith("OK"):
        return
    if "FOUND" in response_text:
        threat = response_text.replace("stream:", "").replace("FOUND", "").strip()
        logger.warning("ClamAV detected threat in %s: %s", file_key, threat)
        raise BadRequestError("File failed virus scan")
    # Any other response is a scanner-side problem — fail closed
    logger.error("ClamAV unexpected response for %s: %s", file_key, response_text)
    raise ServiceUnavailableError("Virus scanner error — file rejected (fail-closed)")


async def _scan_instream_streaming(file_key: str, file_size: int) -> None:
    """Stream file from S3 directly to ClamAV without loading into memory."""
    import asyncio
    import struct

    timeout = settings.clamav_scan_timeout_base + int(
        settings.clamav_scan_timeout_per_gb * file_size / (1024 * 1024 * 1024)
    )

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(settings.clamav_host, settings.clamav_port),
            timeout=10,
        )
    except (ConnectionRefusedError, OSError, TimeoutError) as e:
        logger.error("ClamAV unavailable: %s", e)
        raise ServiceUnavailableError("Virus scanner unavailable — file rejected (fail-closed)")

    try:
        writer.write(b"nINSTREAM\n")

        # Stream chunks from S3 directly to ClamAV
        async with stream_object(file_key) as body:
            while True:
                chunk = await body.read(CLAMAV_CHUNK_SIZE)
                if not chunk:
                    break
                writer.write(struct.pack(">I", len(chunk)) + chunk)

        writer.write(struct.pack(">I", 0))
        await writer.drain()

        response = await asyncio.wait_for(reader.readline(), timeout=timeout)
        response_text = response.decode("utf-8", errors="replace").strip()
    except (OSError, TimeoutError) as e:
        logger.error("ClamAV communication error: %s", e)
        raise ServiceUnavailableError("Virus scanner error — file rejected (fail-closed)")
    finally:
        writer.close()
        await writer.wait_closed()

    if response_text.endswith("OK"):
        return
    if "FOUND" in response_text:
        threat = response_text.replace("stream:", "").replace("FOUND", "").strip()
        logger.warning("ClamAV detected threat in %s: %s", file_key, threat)
        raise BadRequestError("File failed virus scan")
    logger.error("ClamAV unexpected response for %s: %s", file_key, response_text)
    raise ServiceUnavailableError("Virus scanner error — file rejected (fail-closed)")
