# Upload Processing Pipeline (`api/app/workers/process_upload.py`)

## Purpose

This is the heart of the upload system. It runs as an ARQ background job, transforming a raw quarantine file into a clean, compressed, metadata-stripped file ready for use in pull requests. The pipeline emits real-time progress events via Redis pub/sub for the SSE endpoint.

## Current Implementation Structure

The worker is now split into three layers:

- `UploadPipeline` class in `api/app/workers/upload/pipeline.py`
  - Orchestrates the flow by calling stateless stage functions.
  - Manages high-level pipeline state (temp paths, MIME/category, stage progress).
  - Coordinates between the repositories and stages.
- **Repositories** (Abstraction Layer):
  - `UploadWorkerRepository` in `api/app/workers/upload/repository.py`: Encapsulates all DB operations (status updates, checkpoints, DLQ) with built-in **exponential backoff retry** logic for resilience.
  - `UploadCacheRepository` in `api/app/workers/upload/cache_repo.py`: Encapsulates all Redis operations (event publishing, status caching, cancellation checks).
- **Stages** (Stateless Logic) in `api/app/workers/upload/stages/`:
  - `download.py`: `run_download_and_validate`
  - `cas.py`: `try_cas_short_circuit`
  - `scan_strip.py`: `run_scan_and_strip`, `run_strip_only`, `run_post_strip_pdf_check`
  - `compress.py`: `run_compress_stage`
  - `thumbnail.py`: `run_thumbnail_stage` — generates a WebP thumbnail server-side
  - `finalize.py`: `run_finalize_storage`

### Thumbnail Generation (`stages/thumbnail.py`)

`run_thumbnail_stage` runs after compression and before finalization. It dispatches
on MIME type to produce a `640×360` WebP stored at `thumbnails/{version_id}.webp`:

| File type | Tool used |
|---|---|
| Images (`image/*`) | Pillow resize + EXIF rotation |
| Videos (`video/*`) | FFmpeg frame extraction at t=2s → WebP |
| PDFs (`application/pdf`) | Ghostscript first-page render → WebP |
| Office (OOXML, ODF, legacy OLE2) | **LibreOffice headless → PDF → Ghostscript → WebP** |

#### Office rendering detail
All Office formats (`.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt`, `.odt`,
`.ods`, `.odp`) are handled by `_thumbnail_office`:

1. `soffice --headless --convert-to pdf` converts the document to PDF in an
   isolated temp directory (120 s timeout).
2. The resulting PDF is piped through `_thumbnail_pdf` (Ghostscript at 150 dpi
   → PNG → WebP).
3. The temp directory is always cleaned up in `finally`.

**MIME type routing** covers all three Office families:
- OOXML: `officedocument` substring in MIME (e.g. `…wordprocessingml…`)
- ODF: `opendocument` substring in MIME
- Legacy OLE2: exact match against `{application/msword, application/vnd.ms-excel,
  application/vnd.ms-powerpoint}` — these match neither substring above.

**Lock avoidance**: each invocation sets `HOME` to a fresh tempdir so that
concurrent worker processes do not collide on the same LibreOffice user profile.

**Dependency**: requires `libreoffice-nogui` in the Docker image (already added
to `api/Dockerfile`). Also used by the `recalculate-thumbnails` CLI command.

These stages are functional and take explicit inputs, making them easier to test and maintain compared to the previous stateful implementation.

## Pipeline Stages

```
┌─────────────────────────────────────┐    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  0. Scanning  ║  1. Stripping       │───▶│ 2. Compressing│───▶│ 3. Thumbnails │───▶│ 4. Finalizing │
│   (35% wt)    ║   (20% wt)         │    │   (20% wt)    │    │   (15% wt)    │    │   (10% wt)    │
│               ║                    │    │               │    │               │    │               │
│ YARA + Bazaar ║ EXIF, PDF          │    │ Ghostscript,  │    │ LibreOffice,  │    │ Upload to S3, │
│ + PDF safety  ║ Info, tags         │    │ ffmpeg, gzip  │    │ FFmpeg, etc   │    │ CAS entry     │
└─────────────────────────────────────┘    └───────────────┘    └───────────────┘    └───────────────┘
```

**Stages 0 and 1 are typically run in parallel** by `run_scan_and_strip`. The scan result acts as a security gate. Metadata stripping is performed concurrently to reduce total wall-clock time. If the pipeline resumes from a checkpoint where the scan was finished but stripping wasn't, `run_strip_only` is used.

Each stage contributes to the `overall_percent` progress:
- Download & Validate: Part of initial setup.
- Scanning & Stripping: Stages 0 & 1 (55% combined wt).
- Compressing: Stage 2 (20% wt).
- Thumbnailing: Stage 3 (15% wt).
- Finalizing: Stage 4 (10% wt).

### Compression Optimizations

- **Skip threshold:** Files smaller than 10 KiB are not compressed.
- **PDF compression quality:** Configurable via `PDF_QUALITY` env var.
- **Video compression profiles:** Configurable via `VIDEO_COMPRESSION_PROFILE` env var. Utilizes `-preset veryfast` and aggressive CRF values (32 to 60) for high-speed, compact encoding.
- **Image format conversion:** Aggressive WEBP conversion for non-animated images.

## Full Execution Flow

### Pre-Pipeline: Initial Validation

1. Download file from quarantine to temp directory + compute SHA-256 (`run_download_and_validate`).
2. Proceed to full pipeline (Scan -> Strip -> Compress -> Finalize).

### Disk Space Guard

Before downloading, `run_download_and_validate` ensures sufficient headroom:
```python
required_free = int(initial_size * 2.0)
ensure_disk_space(tmp_path, required_free)
```

### Stage 0 & 1: Malware Scanning and Metadata Stripping

1. `run_scan_and_strip` coordinates `MalwareScanner` and `strip_metadata_file` concurrently using `asyncio.gather`.
2. **Concurrency Safety:** If both fail, both errors are logged. Scan errors (malware detection) always take precedence for the final status.
3. For PDFs: `run_post_strip_pdf_check` performs a final safety check on the stripped file.

### Stage 2: Compression

1. `run_compress_stage` determines timeout and applies category-specific compression.
2. If successful, it updates the pipeline's `final_mime` and `content_encoding`.
3. **Fail-open:** If compression fails or times out, the uncompressed file is used.

### Stage 3: Finalization

1. `run_finalize_storage` constructs the final S3 key and **always uploads** the processed file to the `cas/` prefix, replacing any pre-existing object. This ensures compression and stripping improvements propagate even when the same source SHA-256 was previously stored under an older pipeline.
2. It sets all final Redis caches and updates the user quota.
3. `UploadPipeline` then updates the DB status to `clean` via the repository.


## Progress Event Format

Events are published to Redis channel `upload:events:{quarantine_key}` and cached in `upload:status:{quarantine_key}`:

```json
{
  "upload_id": "abc-123",
  "file_key": "quarantine/user/upload/file.pdf",
  "status": "processing",
  "detail": "Scanning for malware",
  "stage_index": 0,
  "stage_total": 4,
  "stage_percent": 0.5,
  "overall_percent": 0.2000
}
```

The `overall_percent` is computed from the weighted stage progress:
```python
overall = sum(weights[:stage_index]) + weights[stage_index] * stage_percent
```

## Event Log

In addition to the status cache and pub/sub, events are appended to a Redis list `upload:eventlog:{key}` (2h TTL). This allows the SSE endpoint to replay missed events for clients that connect after processing has started.

## Error Handling

| Error Type | Handling | Status |
|------------|----------|--------|
| YARA/Bazaar scan failure | Fail-closed: reject upload | FAILED |
| Malware detected | Quarantine preserved for forensics | MALICIOUS |
| PDF auto-exec detected | Treated as malware | MALICIOUS |
| PDF parsing failure | Treated as malware (fail-closed) | MALICIOUS |
| Auto-exec macros (OLE2) | Treated as malware | MALICIOUS |
| Scan timeout | Fail-closed | FAILED |
| Strip timeout | Fail-closed | FAILED |
| Compression timeout | Fail-open: use uncompressed | (continues) |
| Compression error | Fail-open: use uncompressed | (continues) |
| Pipeline deadline exceeded | Fail-closed | FAILED |
| Disk space insufficient | Raises for ARQ retry | (retried) |
| Any other exception | Logged, FAILED status emitted | FAILED |

## Metrics Emitted

- `upload_pipeline_total` — Counter by status (clean/failed/malicious/cas_hit) and MIME category
- `upload_pipeline_duration` — Histogram of total pipeline wall-clock time
- `upload_scan_duration` — Histogram of malware scan stage time
- `upload_file_size` — Histogram of original file sizes
- `upload_compression_ratio` — Histogram of original/compressed size ratio

## Webhook Dispatch

After a successful pipeline, `UploadWorkerRepository.maybe_dispatch_webhook()` checks if the upload DB row has a `webhook_url`. If so, it enqueues a `dispatch_webhook` job. The webhook sends an HMAC-SHA256 signed POST request with the upload result data.

## Pipeline Checkpointing (Phase 2)

Each stage saves its completion to the DB via `_checkpoint_stage(ctx, upload_id, stage)`:

| After stage | `pipeline_stage` value |
|------------|----------------------|
| Scan complete | 1 |
| Strip complete | 2 |
| Compress complete | 3 |
| Thumbnail complete | 4 |
| Finalize complete | — (status=clean) |

On ARQ retry, `_get_pipeline_stage(ctx, upload_id)` reads the DB. Stages with index < `completed_stage` are skipped with a log message. This makes the pipeline idempotent: a crash after scan but before strip retries from the strip stage.

Internally these wrappers now delegate to `UploadWorkerRepository`, which performs the SQLAlchemy `UPDATE`/`SELECT` calls using the worker session factory.

## Upload Cancellation (Phase 2)

`DELETE /api/upload/{upload_id}` (router: `upload/status.py`) sets `upload:cancel:{upload_id}` in Redis with a 1-hour TTL.

The worker calls `_check_cancelled(redis, upload_id)` at three points:
1. Before the pipeline starts (early cancellation)
2. After scan (between stages 0 and 1)
3. After strip (between stages 1 and 2)
4. After compress (between stages 2 and 3)
5. After thumbnailing (between stages 3 and 4)

On cancellation:
- Status updated to `cancelled` in DB (`error_detail = "Cancelled by user"`)
- Quarantine S3 object deleted
- Pipeline exits cleanly (no DLQ entry)

The endpoint also attempts to delete the quarantine S3 object and remove it from the quota sorted set immediately, even if the worker hasn't started yet.

## Dead Letter Queue (Phase 2)

When an upload fails on its last ARQ retry (`job_try >= _MAX_ARQ_RETRIES = 3`), a row is inserted into `dead_letter_jobs` via `_insert_dead_letter()`. The row captures:
- `job_name` — always `"process_upload"`
- `upload_id` — for correlation with the uploads table
- `payload` — original job kwargs (user_id, quarantine_key, filename, mime_type)
- `error_detail` — stringified exception (truncated at 4000 chars)
- `attempts` — number of ARQ attempts made

`_insert_dead_letter` now delegates to `UploadWorkerRepository.insert_dead_letter`.

Admin endpoints (bureau/vieux roles only):
- `GET /api/admin/dlq` — paginated list, defaults to unresolved jobs
- `POST /api/admin/dlq/{id}/retry` — re-enqueues the job with original payload, marks resolved
- `POST /api/admin/dlq/{id}/dismiss` — marks resolved without retrying

A retried job that fails again creates a new DLQ entry (the original entry stays resolved).
