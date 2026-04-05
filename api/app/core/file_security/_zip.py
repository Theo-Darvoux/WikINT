"""ZIP and gzip utilities used across the file security pipeline.

Provides:
- _ZIP_MAX_ENTRY_BYTES / _ZIP_MAX_TOTAL_BYTES: ZIP-bomb thresholds
- _sanitize_zip_entry_name: path traversal sanitizer for ZIP entry names
- _recompress_zip_path: streaming ZIP re-deflate with bomb + traversal protection
- _gzip_compress_path: gzip level 9 compression of a file to a new temp file
- get_uncompressed_size: safe read of ZIP central directory for disk-space guards
"""
import gzip
import logging
import re
import tempfile
import zipfile
from pathlib import Path

logger = logging.getLogger("wikint")

# ZIP bomb protection thresholds
_ZIP_MAX_ENTRY_BYTES = 200 * 1024 * 1024  # 200 MB per entry
_ZIP_MAX_TOTAL_BYTES = 500 * 1024 * 1024  # 500 MB total uncompressed


def _sanitize_zip_entry_name(name: str) -> str:
    """Sanitize a ZIP entry filename to prevent path traversal on extraction.

    - Strips leading slashes and drive specifiers
    - Replaces ``..`` path components with ``_``
    - Removes null bytes and ASCII control characters
    - Truncates each path segment to 255 characters
    """
    # Remove null bytes and ASCII control characters
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    # Strip leading slashes and Windows drive letters (e.g. C:\\)
    name = re.sub(r"^([a-zA-Z]:[\\/]|[/\\]+)", "", name)
    # Sanitize each path component individually
    parts = re.split(r"[\\/]", name)
    safe_parts = [
        "_" if (p == ".." or p == ".") else p[:255]
        for p in parts
        if p  # skip empty segments produced by consecutive separators
    ]
    return "/".join(safe_parts) or "_unknown_"


def _recompress_zip_path(file_path: Path) -> Path:
    """Re-compress a ZIP file at maximum compression with bomb + traversal protection.

    Returns a new temp file path if the recompressed archive is smaller than
    the original; otherwise returns the original path unchanged.

    Raises:
        ValueError: if entry or total size exceeds configured limits.
        zipfile.BadZipFile: if the input is not a valid ZIP.
    """
    out_name = tempfile.NamedTemporaryFile(suffix=".zip", delete=False).name
    try:
        with (
            zipfile.ZipFile(file_path, "r") as zin,
            zipfile.ZipFile(out_name, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zout,
        ):
            total_declared = sum(i.file_size for i in zin.infolist())
            if total_declared > _ZIP_MAX_TOTAL_BYTES:
                raise ValueError("ZIP archive uncompressed content is too large")

            total_actual_written = 0
            for item in zin.infolist():
                if item.file_size > _ZIP_MAX_ENTRY_BYTES:
                    raise ValueError(f"ZIP entry '{item.filename}' is too large")
                safe_name = _sanitize_zip_entry_name(item.filename)
                new_info = zipfile.ZipInfo(filename=safe_name, date_time=item.date_time)
                new_info.compress_type = zipfile.ZIP_DEFLATED
                with zin.open(item) as src, zout.open(new_info, "w") as dest:
                    written = 0
                    while True:
                        chunk = src.read(65536)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > _ZIP_MAX_ENTRY_BYTES:
                            raise ValueError(
                                f"ZIP entry '{item.filename}' expanded beyond limit"
                            )
                        total_actual_written += len(chunk)
                        if total_actual_written > _ZIP_MAX_TOTAL_BYTES:
                            raise ValueError("ZIP archive actual uncompressed content exceeds total limit")
                        dest.write(chunk)

        if Path(out_name).stat().st_size < file_path.stat().st_size:
            return Path(out_name)
    except Exception:
        Path(out_name).unlink(missing_ok=True)
        raise
    Path(out_name).unlink(missing_ok=True)
    return file_path


def _gzip_compress_path(file_path: Path) -> Path:
    """Compress *file_path* with gzip level 9, returning a new temp file.

    Returns the original path if the compressed output is not smaller.
    """
    out_name = tempfile.NamedTemporaryFile(suffix=".gz", delete=False).name
    try:
        with open(file_path, "rb") as f_in, gzip.open(out_name, "wb", compresslevel=9) as f_out:
            import shutil

            shutil.copyfileobj(f_in, f_out)
        if Path(out_name).stat().st_size < file_path.stat().st_size:
            return Path(out_name)
    except Exception:
        Path(out_name).unlink(missing_ok=True)
        raise
    Path(out_name).unlink(missing_ok=True)
    return file_path


def get_uncompressed_size(file_path: Path) -> int:
    """Return total uncompressed size of all entries in a ZIP archive.

    Safe to call: only reads the central directory (no full-file read or extraction).
    Returns 0 if the file is not a valid ZIP.
    """
    try:
        if not zipfile.is_zipfile(file_path):
            return 0
        with zipfile.ZipFile(file_path, "r") as z:
            return sum(info.file_size for info in z.infolist())
    except Exception:
        return 0
