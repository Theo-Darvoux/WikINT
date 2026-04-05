import mimetypes
from pathlib import Path
from typing import Final

# ────────────────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────────────────

# Allowed file extensions — matches viewer-supported types
ALLOWED_EXTENSIONS: Final[frozenset[str]] = frozenset(
    {
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
        ".xml",
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
)

# Whitelist of trusted extension -> MIME mappings.
EXTENSION_MAPPING: Final[dict[str, list[str]]] = {
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
    ".webm": ["video/webm", "audio/webm"],
    ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ".epub": ["application/epub+zip"],
    ".djvu": ["image/vnd.djvu"],
    ".djv": ["image/vnd.djvu"],
    ".doc": ["application/msword"],
    ".xls": ["application/vnd.ms-excel"],
    ".ppt": ["application/vnd.ms-powerpoint"],
}

# Reverse mapping: MIME type -> canonical extension
MIME_TO_EXTENSION: Final[dict[str, str]] = {
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
    "audio/webm": ".webm",
    "application/epub+zip": ".epub",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/msword": ".doc",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.ms-powerpoint": ".ppt",
}

# MIME types safe for gzip with Content-Encoding header
GZIP_MIME_TYPES: Final[frozenset[str]] = frozenset(
    {
        "application/json",
        "application/xml",
        "application/x-yaml",
        "text/yaml",
        "image/svg+xml",
    }
)

# MIME types that are ZIP archives
ZIP_MIME_TYPES: Final[frozenset[str]] = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/epub+zip",
    }
)

# Legacy Office MIME types (OLE2)
OLE2_MIME_TYPES: Final[frozenset[str]] = frozenset(
    {
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
    }
)

# Flattened set of all allowed MIME types for strict server-side rejection.
# Includes both binary formats and common text/code types.
ALLOWED_MIME_TYPES: Final[frozenset[str]] = frozenset(
    {
        # Flattened from EXTENSION_MAPPING
        *[mime for mimes in EXTENSION_MAPPING.values() for mime in mimes],
        # Text / code types (often guessed as text/plain or specialized mimetypes)
        "text/plain",
        "text/markdown",
        "text/csv",
        "text/css",
        "text/javascript",
        "text/x-python",
        "text/x-java-source",
        "text/x-c",
        "text/x-c++",
        "application/json",
        "application/xml",
        "application/x-yaml",
        "text/yaml",
        "application/javascript",
        "application/typescript",
        "application/x-sh",
        "application/sql",
    }
)

# ────────────────────────────────────────────────────────────────────────────────
# Logic
# ────────────────────────────────────────────────────────────────────────────────


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

    # SVG — must appear near the document start (after optional BOM / XML declaration)
    _stripped = data[:500].lstrip()
    _lower = _stripped.lower()
    if _lower.startswith(b"<svg") or (
        _lower.startswith(b"<?xml") and b"<svg" in _lower
    ):
        return "image/svg+xml"

    # DjVu
    if data.startswith(b"AT&TFORM"):
        return "image/vnd.djvu"

    # ZIP-based formats (OOXML, EPUB, ODF)
    if data.startswith(b"PK\x03\x04"):
        header = data[:200]
        if b"mimetypeapplication/epub+zip" in header:
            return "application/epub+zip"
        if b"mimetypeapplication/vnd.oasis.opendocument.text" in header:
            return "application/vnd.oasis.opendocument.text"
        if b"mimetypeapplication/vnd.oasis.opendocument.spreadsheet" in header:
            return "application/vnd.oasis.opendocument.spreadsheet"
        if b"mimetypeapplication/vnd.oasis.opendocument.presentation" in header:
            return "application/vnd.oasis.opendocument.presentation"
        # OOXML
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
        brand = data[8:12] if len(data) >= 12 else b""
        if brand in (b"M4A ", b"M4B "):
            return "audio/mp4"
        return "video/mp4"

    # Legacy MS Office (OLE2)
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return default

    return default


def guess_mime_from_file_path(path: Path) -> str:
    """Read first 2KB of file and guess MIME from bytes."""
    with open(path, "rb") as f:
        data = f.read(2048)
    return guess_mime_from_bytes(data)


class MimeRegistry:
    """Central registry for file type validation and canonical mapping."""

    @staticmethod
    def is_supported_extension(ext: str) -> bool:
        return ext.lower() in ALLOWED_EXTENSIONS

    @staticmethod
    def get_canonical_extension(mime_type: str) -> str | None:
        return MIME_TO_EXTENSION.get(mime_type)

    @staticmethod
    def get_allowed_mimes_for_extension(ext: str) -> list[str]:
        return EXTENSION_MAPPING.get(ext.lower(), [])

    @staticmethod
    def is_allowed_mime(mime_type: str) -> bool:
        """Strict check: is this MIME type explicitly allowed for upload?"""
        return mime_type.lower() in ALLOWED_MIME_TYPES

    @staticmethod
    def get_authoritative_mime(filename: str, magic_mime: str) -> str:
        """Resolve MIME type giving precedence to magic bytes, falling back to extension."""
        if magic_mime != "application/octet-stream":
            return magic_mime

        guessed, _ = mimetypes.guess_type(filename)
        return guessed or "application/octet-stream"
