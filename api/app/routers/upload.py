import json
import logging
import mimetypes
import os
import re
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, UploadFile
from redis.asyncio import Redis

from app.config import settings
from app.core.exceptions import BadRequestError
from app.core.file_security import strip_metadata
from app.core.redis import get_redis
from app.core.scanner import scan_file
from app.core.storage import get_s3_client
from app.dependencies.auth import CurrentUser
from app.dependencies.rate_limit import rate_limit_uploads
from app.schemas.material import UploadCompleteOut

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
# provides idempotent responses for retried upload calls.
_SCAN_CACHE_PREFIX = "upload:scanned:"
_SCAN_CACHE_TTL = 3600  # 1 hour


@router.post("", response_model=UploadCompleteOut)
async def upload_file(
    file: UploadFile,
    user: CurrentUser,
    redis: Annotated[Redis, Depends(get_redis)],
    _: Annotated[None, Depends(rate_limit_uploads)],
) -> UploadCompleteOut:
    """Upload a file: validate, scan for malware, strip metadata, then store in S3.

    Files are scanned BEFORE reaching object storage. If the scan fails or detects
    a threat, the file is rejected and never stored.
    """
    # ── Validate filename ──
    raw_name = file.filename or "unnamed"
    safe_name = os.path.basename(raw_name)
    safe_name = re.sub(r"[\x00-\x1f\x7f]", "", safe_name)
    safe_name = re.sub(r"[\u200b-\u200f\u2028-\u202f\u2060\ufeff]", "", safe_name)
    safe_name = re.sub(r"[\s#%&{}\\<>*?/$!'\":@+`|=^~\[\]]", "_", safe_name)
    safe_name = re.sub(r"_+", "_", safe_name).strip("_.")
    if not safe_name:
        raise BadRequestError("Invalid filename")

    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise BadRequestError(f"File type '{ext}' is not supported")

    # ── Read file bytes ──
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    file_bytes = await file.read(max_bytes + 1)
    if len(file_bytes) > max_bytes:
        raise BadRequestError(f"File size exceeds maximum of {settings.max_file_size_mb} MiB")

    file_size = len(file_bytes)

    # ── MIME detection from magic bytes ──
    real_mime = guess_mime_from_bytes(file_bytes[:2048])

    if real_mime != "application/octet-stream":
        allowed_mimes = EXTENSION_MAPPING.get(ext, [])
        if allowed_mimes and real_mime not in allowed_mimes:
            correct_ext = MIME_TO_EXTENSION.get(real_mime)
            if correct_ext:
                stem = os.path.splitext(safe_name)[0]
                new_name = stem + correct_ext
                logger.warning(
                    "Extension mismatch: renaming %s -> %s (detected: %s)",
                    safe_name,
                    new_name,
                    real_mime,
                )
                safe_name = new_name
                ext = correct_ext
            else:
                logger.warning(
                    "Extension mismatch with no known correction. File: %s, Detected: %s, Extension: %s",
                    safe_name,
                    real_mime,
                    ext,
                )

    # Establish authoritative MIME type
    mime_type = real_mime
    if mime_type == "application/octet-stream":
        guessed, _encoding = mimetypes.guess_type(safe_name)
        mime_type = guessed or "application/octet-stream"

    # ── SVG safety check ──
    if mime_type == "image/svg+xml":
        if file_size > LARGE_FILE_THRESHOLD:
            raise BadRequestError(
                f"SVG files must be under {LARGE_FILE_THRESHOLD // (1024 * 1024)} MiB"
            )
        _check_svg_safety(file_bytes, safe_name)

    # ── Strip metadata ──
    clean_bytes = strip_metadata(file_bytes, mime_type)
    if len(clean_bytes) != len(file_bytes):
        logger.info("Metadata stripped from %s (mime: %s)", safe_name, mime_type)
        file_bytes = clean_bytes
        file_size = len(clean_bytes)

    # ── Malware scan (YARA + MalwareBazaar) — BEFORE any S3 interaction ──
    await scan_file(file_bytes, safe_name)

    # ── Upload clean file to S3 ──
    file_key = f"uploads/{user.id}/{uuid4()}/{safe_name}"

    # Cap pending uploads per user
    if user.role not in ("member", "bureau", "vieux"):
        async with get_s3_client() as s3:
            paginator = s3.get_paginator("list_objects_v2")
            count = 0
            async for page in paginator.paginate(
                Bucket=settings.s3_bucket,
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

    async with get_s3_client() as s3:
        await s3.put_object(
            Bucket=settings.s3_bucket,
            Key=file_key,
            Body=file_bytes,
            ContentType=mime_type,
        )

    result = UploadCompleteOut(
        file_key=file_key,
        size=file_size,
        mime_type=mime_type,
    )

    # Cache the scan result so PR validation can confirm this file was scanned
    cache_key = f"{_SCAN_CACHE_PREFIX}{file_key}"
    await redis.set(
        cache_key,
        json.dumps(result.model_dump()),
        ex=_SCAN_CACHE_TTL,
    )

    return result


# ── Deprecation stubs for old endpoints ──


@router.post("/request-url", deprecated=True)
async def request_upload_url_deprecated() -> None:
    raise BadRequestError(
        "This endpoint has been removed. Upload files directly via POST /api/upload."
    )


@router.post("/complete", deprecated=True)
async def complete_upload_deprecated() -> None:
    raise BadRequestError(
        "This endpoint has been removed. Upload files directly via POST /api/upload."
    )
