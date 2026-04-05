# File Security Package (`api/app/core/file_security/`)

## Purpose

This is the most security-critical module in the codebase. It implements a defense-in-depth pipeline that every uploaded file passes through: metadata stripping (PII removal), active content detection (macros, JavaScript), format-specific sanitization, and compression. The module operates on the principle of **fail-closed for high-risk types** (images, PDFs) and **fail-open for others** (the YARA scan still runs regardless).

## Architecture

The monolith module has been refactored into a modular package:
1. **Public API (`__init__.py`)** - Exposes the dispatcher functions `strip_metadata_file` and `compress_file_path`.
2. **Dispatchers (`strip.py`, `compress.py`)** - Route file-path operations to format-specific implementations based on MIME type.
3. **Format-Specific Handlers** - Dedicated submodules for each file category (`_image.py`, `_pdf.py`, `_svg.py`, `_audio_video.py`, `_office.py`, `_zip.py`).
4. **Shared Concurrency (`_concurrency.py`)** - Manages resource constraints (e.g. bounding concurrent Ghostscript/FFmpeg processes).

The API relies entirely on path-based operations (`file_path: Path`) to process files directly on-disk without buffering large objects in memory. The legacy bytes-based API was fully removed to pay down technical debt.

## Format-Specific Handlers

### Images (`_image.py` -> `_strip_image_from_path`)

**Decompression bomb protection:** `Image.MAX_IMAGE_PIXELS` is set to 50,000,000 (50 megapixels) to prevent decompression bomb attacks where a small compressed image expands to consume all available memory.

**Strategy:** Re-save the image through Pillow, discarding all metadata (EXIF, IPTC, XMP).

- **JPEG:** Re-saved with `optimize=True, progressive=True`
- **PNG:** Re-saved with `optimize=True, compress_level=6`
- **WEBP:** Re-saved with `method=6` (highest compression effort)
- **GIF:** Special handling for animated GIFs — all frames are extracted, frame durations preserved, loop count preserved, then re-saved with `save_all=True`. A `MAX_GIF_FRAMES = 500` limit prevents GIF bomb DoS attacks.
- **Other formats:** Re-saved as-is (metadata stripped by virtue of not being copied)

**Failure mode:** Fail-closed. If Pillow cannot process the image, a `ValueError` is raised and the upload is rejected. This prevents bypassing metadata stripping by providing a malformed image.

### PDFs

#### Safety Check (`check_pdf_safety`)

Runs BEFORE metadata stripping. Uses `pikepdf` to inspect the PDF catalog and page tree for dangerous constructs:

**Catalog-level checks** (`_PDF_DANGEROUS_ACTION_KEYS`):
- `/OpenAction` — Auto-executing action on document open (CVE-2018-4993 class)
- `/AA` (Additional Actions) — Event-triggered actions on the document catalog
- `/Launch` — Launch external applications
- `/GoToR` — Navigate to remote PDF (can trigger network requests)
- `/URI` — Open arbitrary URLs
- `/SubmitForm` — Submit form data to external servers
- `/ImportData` — Import data from external sources
- `/JavaScript` in the Names tree — Embedded JavaScript

**Page tree walk** (`_walk_page_tree_for_actions`):
Recursively walks the page tree (with a depth limit of 50 to prevent circular reference DoS) checking each page node for `/AA`, `/Launch`, `/GoToR`, `/URI`, `/SubmitForm`, and `/ImportData` action dictionaries.

**Failure mode:** `ValueError` on detection → upload rejected as MALICIOUS. If pikepdf cannot parse the PDF at all, it fails open (lets YARA handle it).

#### Metadata Stripping (`_strip_pdf_from_path`)

Uses `pikepdf` to remove:
- `/Info` dictionary (author, title, creation date, producer)
- XMP metadata stream (via `pdf.open_metadata()` context manager)
- `/OpenAction` (redundant with safety check, but defense-in-depth)
- `/AA` on catalog and all pages
- `/EmbeddedFiles` from the Names tree (attached files that can carry payloads)

### Legacy Office Documents (OLE2: .doc, .xls, .ppt)

#### Macro Detection (`_check_ole2_macros`)

Uses `oletools.VBA_Parser` (lazy-imported, **required** dependency — ImportError propagates at runtime) to:
1. Detect VBA macros in the file
2. If macros exist, scan for auto-executing entry points: `AutoOpen`, `Document_Open`, `Workbook_Open`, `Auto_Open`, `AutoExec`, `AutoClose`
3. **Auto-exec macros → ValueError → upload rejected**
4. Non-auto-exec macros → warning logged, file allowed through (YARA is the authoritative gate)

**Failure mode:** oletools is a hard dependency — if not installed, the import fails at startup (checked in `workers/settings.py`). If oletools raises an unexpected error during scanning, the check is skipped (fail-open). YARA still scans the file.

#### Metadata Stripping

Uses `exiftool` (via sandboxed subprocess) with `-all= -overwrite_original` to strip all metadata fields. The subprocess runs inside a Bubblewrap sandbox (see Sandbox section below).

### Modern Office Documents (OOXML: .docx, .xlsx, .pptx)

#### Metadata Stripping (`_strip_ooxml_from_path`)

Opens the file as a ZIP archive and reconstructs it without:
- `docProps/` directory (contains `core.xml` with author/dates and `app.xml` with application info)
- `docProps/thumbnail` (can contain sensitive preview images)

**ZIP bomb protection:**
- `_ZIP_MAX_ENTRY_BYTES = 200 MiB` per entry
- `_ZIP_MAX_TOTAL_BYTES = 500 MiB` total uncompressed size
- Both declared and actual sizes are checked (prevents zip bombs where declared size is small but actual decompressed data is huge)
- Processing is streamed in 64KB chunks rather than reading entire entries into memory, preventing Out-Of-Memory (OOM) errors during concurrent worker execution.
- A cumulative `total_actual_written` counter tracks the true decompressed size across all entries in `_strip_ooxml_from_path` and `_recompress_zip_path`. The stream is aborted immediately if it exceeds the global 500 MiB limit, preventing zip bombs from exhausting storage even if local headers are forged.

### Video Files (.mp4, .webm, .ogv)

Uses `ffmpeg` (via sandboxed subprocess) with:
```
ffmpeg -y -i input -map_metadata -1 -c copy output
```

`-map_metadata -1` strips all global and stream metadata. `-c copy` avoids re-encoding (fast, lossless).

### Audio Files (.mp3, .flac, .ogg, .wav, .m4a, .aac)

Uses `mutagen` library to delete ID3/Vorbis/MP4 tags. Format detection uses filename hints (`_AUDIO_FILENAME_HINTS` dict) because mutagen's magic-byte detection can be ambiguous for some formats.

## Subprocess Concurrency Control (`_concurrency.py`)

A module-level `asyncio.Semaphore` combined with a Redis-distributed lock limits concurrent heavy tasks:

```python
_subprocess_sem = asyncio.Semaphore(max(2, int(os.cpu_count() * 1.5)))
_global_sem = DistributedSemaphore(redis, "upload:global_ops_lock")
```

This ensures Ghostscript, FFmpeg, and massive image conversions do not capture all thread-pool slots and starve lighter upload workloads, effectively balancing multi-core processing with memory constraints. Every heavy subprocess call acquires the concurrency guard:

```python
async with _get_concurrency_guard("pdf"):
    result = await _compress_pdf_path(...)
```

## Sandbox Module (`api/app/core/sandbox.py`)

All external tool invocations (exiftool, ffmpeg) run inside a **Bubblewrap (bwrap)** sandbox when available.

### Sandbox Policy

```
bwrap --unshare-all --die-with-parent --new-session
  --ro-bind /usr /usr          # System binaries
  --ro-bind /lib /lib          # Shared libraries
  --ro-bind /etc/fonts         # Font config for Ghostscript
  --bind /tmp/workdir /tmp/workdir  # Read-write: only the specific temp dir
  --dev /dev --proc /proc --tmpfs /tmp
  -- ffmpeg -y -i ...
```

**What this achieves:**
- New PID/network/IPC/UTS/cgroup namespaces (`--unshare-all`) — the process cannot see other processes, cannot make network requests, cannot use IPC
- Read-only system binaries — the process cannot modify the system
- Read-write access ONLY to explicitly listed paths (temp directories containing input/output files)
- `--die-with-parent` — if the API process dies, the sandboxed process is killed (no orphans)
- `--new-session` — detaches from the controlling terminal

**Hard dependency:** `bwrap` must be installed. If not found, `sandboxed_run()` raises `RuntimeError` immediately. Worker startup checks for `bwrap` availability via `shutil.which("bwrap")`.

**Security Configuration (Docker):** To function inside a Docker container, the sandbox relies on unprivileged user namespaces. The `bwrap` binary is no longer configured as setuid root. Additionally, the sandbox logic in `sandbox.py` automatically detects a Docker environment (via `/.dockerenv`) and modifies the isolation strategy: it avoids unsharing the PID namespace and bind-mounts the host's `/proc` read-only (`--ro-bind /proc /proc` instead of `--proc /proc`). This prevents `capset: Operation not permitted` and `Can't mount proc` errors that occur when attempting to create a nested PID namespace or a new procfs mount within unprivileged container namespaces.
 
 There is no unsandboxed fallback — this is a deliberate security decision to prevent accidental production deployment without sandboxing.

## Compression (`compress_file_path`)

After metadata stripping, files are optionally compressed:

- **Images:** Two-pass approach. First pass (Stage 1) stripped of metadata via Pillow re-save. Second pass (Stage 2) performs aggressive 2K resize and forceful transcoding to `WEBP` format (animated GIFs excluded).
- **PDFs:** Ghostscript with `/printer` quality preset by default (configurable via `GS_QUALITY` as a Literal). Options include `/screen`, `/ebook`, `/printer`, `/prepress`.
- **Audio:** Lossy conversion to **Opus** (96k) via FFmpeg. Converted files use the `audio/webm` MIME type for broad browser support.
- **SVG:** `scour` library for SVG optimization (removes unnecessary elements, whitespace) followed by gzip compression.
- **Text/JSON/XML/YAML:** gzip compression (level 9) with `Content-Encoding: gzip` header.
- **ZIP formats (DOCX/XLSX/PPTX/EPUB):** Re-compressed by iterating through ZIP entries and writing a compressed archive.
- **Video:** FFmpeg dynamically mapped re-encode governed by the `video_compression_profile` config, permitting configurable capping from lossless to heavy 480p/24fps limiting.

Compression timeouts are per-MIME-category (see `_COMPRESSION_TIMEOUTS` in `process_upload.py`).

## SVG Security (`check_svg_safety` / `SvgSecurityError`)

SVGs are a special attack vector because they can contain:
- `<script>` tags (XSS)
- `<foreignObject>` (HTML injection)
- `javascript:` URI schemes in attributes
- External entity references

The SVG safety check uses `defusedxml` for parsing and scans for these patterns. SVGs are also size-limited to `max_svg_size_mb` (default 5 MiB) because they're processed in-memory.

## MIME Type System (`api/app/core/mimetypes.py`)

### Extension Whitelist

`ALLOWED_EXTENSIONS` is a frozen set of ~80 file extensions covering documents, images, audio, video, Office formats, and text/code files.

### MIME Validation

The `MimeRegistry` class provides:
- `is_supported_extension(ext)` — Is this extension in the whitelist?
- `is_allowed_mime(mime_type)` — Is this MIME type explicitly allowed? Text types are always allowed.
- `get_allowed_mimes_for_extension(ext)` — Which MIME types are valid for this extension?
- `get_authoritative_mime(filename, magic_mime)` — Resolves MIME type giving precedence to magic bytes

### Magic Byte Detection

`guess_mime_from_bytes(data)` implements custom magic number detection for all supported types:
- PDF: `%PDF-`
- PNG: `\x89PNG\r\n\x1a\n`
- JPEG: `\xff\xd8\xff`
- GIF: `GIF87a` / `GIF89a`
- WEBP: `RIFF....WEBP`
- SVG: `<svg` at/near document start (first 500 bytes after whitespace stripping; must start with `<svg` or `<?xml` followed by `<svg`)
- DjVu: `AT&TFORM`
- ZIP-based: `PK\x03\x04` with sub-detection for EPUB, ODF, OOXML by inspecting internal structure
- Audio: ID3 tags, fLaC, OggS, RIFF/WAVE, ftyp atoms
- OLE2: `\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1`

### MIME Category Constants

- `GZIP_MIME_TYPES` — Types safe for gzip Content-Encoding (JSON, XML, YAML, SVG)
- `ZIP_MIME_TYPES` — ZIP-based formats (OOXML, EPUB, ODF)
- `OLE2_MIME_TYPES` — Legacy Office (DOC, XLS, PPT)
