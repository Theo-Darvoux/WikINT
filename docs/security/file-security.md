# File Security Package (`api/app/core/file_security/`)

## Purpose

This is the most security-critical module in the codebase. It implements a defense-in-depth pipeline that every uploaded file passes through: metadata stripping (PII removal), active content detection (macros, JavaScript), format-specific sanitization, and compression. The module operates on the principle of **fail-closed for high-risk types** (images, PDFs) and **fail-open for others** (the YARA scan still runs regardless).

## Architecture

The monolith module has been refactored into a modular package:
1. **Public API (`__init__.py`)** - Exposes the dispatcher functions `strip_metadata_file` and `compress_file_path`.
2. **Dispatchers (`strip.py`, `compress.py`)** - Route file-path operations to format-specific implementations based on MIME type.
3. **Format-Specific Handlers** - Dedicated submodules for each file category:
    - `_pdf.py`: Structural validation (pikepdf) and two-stage compression (GS + pikepdf).
    - `_image.py`: Decompression bomb protection and Pillow-based stripping.
    - `_audio_video.py`: Mutagen-based audio stripping and FFmpeg-based video conversion.
    - `_office.py`: OLE2 macro detection and OOXML/ODF structural stripping.
    - `_svg.py`: `defusedxml` validation and optimization.
    - `_zip.py`: Safe ZIP recompression and size limit enforcement.
4. **Shared Concurrency (`_concurrency.py`)** - Manages resource constraints (e.g. bounding concurrent Ghostscript/FFmpeg processes).

The API relies entirely on path-based operations (`file_path: Path`) to process files directly on-disk using `app.core.processing.ProcessingFile`.

## Format-Specific Handlers

### Images (`_image.py`)

**Decompression bomb protection:** `Image.MAX_IMAGE_PIXELS` is set to 50,000,000 (50 megapixels) to prevent decompression bomb attacks.

**Strategy:** Re-save the image through Pillow, discarding all metadata (EXIF, IPTC, XMP).
- **JPEG:** Re-saved with `optimize=True, progressive=True`.
- **PNG:** Re-saved with `optimize=True, compress_level=6`.
- **WEBP:** Re-saved with `method=6`.
- **GIF:** Frames extracted, durations preserved, re-saved with `MAX_GIF_FRAMES = 500` limit.

### PDFs (`_pdf.py`)

#### Safety Check (`check_pdf_safety`)
Uses `pikepdf` to inspect the PDF catalog and page tree for dangerous constructs:
- **Catalog-level**: `/OpenAction`, `/AA`, `/Launch`, `/GoToR`, `/URI`, `/SubmitForm`, `/ImportData`, and `/JavaScript` in Names tree.
- **Page tree**: Recursive walk (depth limit 50) checking for `/AA` and other event triggers.

#### Compression (`_compress_pdf_path`)
Implements a sophisticated two-stage compression pipeline:
1. **Stage 1 (Ghostscript)**: Subsets fonts and resamples images. This is the dominant source of savings for academic PDFs with massive unsubsetted font families.
2. **Stage 2 (PikePDF)**: Repacks object streams (PDF 1.5 cross-reference streams) and performs FlateDecode recompression on the GS output.

### Office Documents (`_office.py`)

#### Legacy OLE2 (.doc, .xls, .ppt)
Uses `oletools.VBA_Parser` to detect auto-executing macros (`AutoOpen`, `Document_Open`, etc.). Metadata is stripped via a sandboxed `exiftool` invocation.

#### Modern OOXML/ODF (.docx, .xlsx, .pptx, .odt)
Reconstructs the ZIP archive, explicitly excluding:
- `docProps/` (core/app metadata)
- `Basic/`, `Scripts/` (ODF macros)
- Embedded thumbnails.

### Audio & Video (`_audio_video.py`)

- **Audio**: Uses `mutagen` to delete all tags. Optionally converts to high-compression **Opus (96k)** via FFmpeg.
- **Video**: Uses FFmpeg stream-copy (`-c copy`) for metadata stripping. Compression performs a full re-encode based on the `video_compression_profile` (Light to Extreme).

## Concurrency & Sandbox

### Concurrency Control (`_concurrency.py`)
A module-level `asyncio.Semaphore` limits concurrent heavy tasks (Ghostscript, FFmpeg) to `cpu_count * 1.5` per worker, preventing OOM and thread starvation.

### Sandbox (`sandbox.py`)
All external tools (`gs`, `ffmpeg`, `exiftool`) run inside a **Bubblewrap (bwrap)** sandbox.
- **Isolation**: `--unshare-all`, `--new-session`, `--die-with-parent`.
- **Mounts**: System binaries/libs are read-only; only specific temp workdirs are read-write.
- **Docker Support**: Automatically detects container environment to adjust procfs mounting and user namespace handling.

## SVG Security (`_svg.py`)
Uses `defusedxml` to parse and strip external entities, prevents XSS/foreignObject injection, and optimizes via `scour`.

## ZIP Protection (`_zip.py`)
Implements mandatory ZIP bomb protection:
- `_ZIP_MAX_ENTRY_BYTES = 200 MiB`
- `_ZIP_MAX_TOTAL_BYTES = 500 MiB`
- Actual uncompressed bytes are counted during streaming; processed size is rejected if limits are exceeded.
- `OLE2_MIME_TYPES` — Legacy Office (DOC, XLS, PPT)
