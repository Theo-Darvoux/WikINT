"""file_security — file safety, metadata stripping, and compression.

This package is the drop-in replacement for the former monolithic
``app/core/file_security.py``. All public symbols are re-exported here so
existing imports remain valid without modification.

Public API (path-based, production):
    strip_metadata_file   — remove metadata from a file on disk
    compress_file_path    — compress a file on disk
    CompressResultPath    — NamedTuple returned by compress_file_path
    check_pdf_safety      — structural PDF safety validation
    check_svg_safety      — SVG allowlist-based safety check
    check_svg_safety_stream — stream variant for SVG safety check
    SvgSecurityError      — exception raised on SVG violation
    get_uncompressed_size — safe ZIP central-directory size query
    run_managed_subprocess— subprocess with global concurrency guard

Deprecated API (bytes-based, tests only):
    strip_metadata        — bytes→bytes metadata strip
    compress_file         — bytes→bytes compression
    CompressResult        — NamedTuple for deprecated compress_file
"""

# Re-export stdlib modules that tests mock at the package namespace level.

# ── Concurrency ───────────────────────────────────────────────────────────────
from app.core.file_security._audio_video import (
    VIDEO_COMPRESS_THRESHOLD,
    _build_video_codec_args,
    _compress_video_path,
    _convert_to_opus_path,
    _strip_audio_from_path,
    _strip_video_from_path,
)

# ── Concurrency ───────────────────────────────────────────────────────────────
from app.core.file_security._concurrency import (
    _get_concurrency_guard,
    run_managed_subprocess,
)

# ── Image ─────────────────────────────────────────────────────────────────────
from app.core.file_security._image import (
    MAX_GIF_FRAMES,
    MAX_GIF_TOTAL_PIXELS,
    _compress_image_bytes,
    _compress_image_path,
    _save_compressed_image,
    _save_stripped_image,
    _strip_gif_to_dest,
    _strip_image_from_path,
    _strip_image_metadata,
)

# ── Office ────────────────────────────────────────────────────────────────────
from app.core.file_security._office import (
    _OLE2_AUTO_EXEC,
    _check_ole2_macros,
    _scan_vba_for_autoexec,
    _strip_ole2_from_path,
    _strip_ooxml_from_path,
)

# ── PDF ───────────────────────────────────────────────────────────────────────
from app.core.file_security._pdf import (
    _PDF_DANGEROUS_ACTION_KEYS,
    _apply_pdf_security_strip,
    _compress_pdf_path,
    _strip_pdf_from_path,
    _walk_page_tree_for_actions,
    check_pdf_safety,
)

# ── SVG ───────────────────────────────────────────────────────────────────────
from app.core.file_security._svg import (
    SvgSecurityError,
    _optimize_svg,
    check_svg_safety,
    check_svg_safety_stream,
)

# ── ZIP / Gzip ────────────────────────────────────────────────────────────────
from app.core.file_security._zip import (
    _ZIP_MAX_ENTRY_BYTES,
    _ZIP_MAX_TOTAL_BYTES,
    _gzip_compress_path,
    _recompress_zip_path,
    _sanitize_zip_entry_name,
    get_uncompressed_size,
)

# ── Compress dispatcher ───────────────────────────────────────────────────────
from app.core.file_security.compress import (
    _COMPRESSION_SKIP_THRESHOLD,
    CompressResultPath,
    compress_file_path,
)

# ── Strip dispatcher ──────────────────────────────────────────────────────────
from app.core.file_security.strip import strip_metadata_file

__all__ = [
    # Active path-based API
    "strip_metadata_file",
    "compress_file_path",
    "CompressResultPath",
    "check_pdf_safety",
    "check_svg_safety",
    "check_svg_safety_stream",
    "SvgSecurityError",
    "get_uncompressed_size",
    "run_managed_subprocess",
    "VIDEO_COMPRESS_THRESHOLD",
    # Internal helpers (used by tests and process_upload)
    "_PDF_DANGEROUS_ACTION_KEYS",
    "_walk_page_tree_for_actions",
    "_apply_pdf_security_strip",
    "_strip_pdf_from_path",
    "_compress_pdf_path",
    "_optimize_svg",
    "_strip_image_from_path",
    "_strip_image_metadata",
    "_compress_image_path",
    "_compress_image_bytes",
    "_save_stripped_image",
    "_save_compressed_image",
    "_strip_gif_to_dest",
    "MAX_GIF_FRAMES",
    "MAX_GIF_TOTAL_PIXELS",
    "_strip_video_from_path",
    "_strip_audio_from_path",
    "_compress_video_path",
    "_convert_to_opus_path",
    "_build_video_codec_args",
    "_OLE2_AUTO_EXEC",
    "_check_ole2_macros",
    "_scan_vba_for_autoexec",
    "_strip_ole2_from_path",
    "_strip_ooxml_from_path",
    "_sanitize_zip_entry_name",
    "_recompress_zip_path",
    "_gzip_compress_path",
    "_ZIP_MAX_ENTRY_BYTES",
    "_ZIP_MAX_TOTAL_BYTES",
    "_get_concurrency_guard",
    "_COMPRESSION_SKIP_THRESHOLD",
]
