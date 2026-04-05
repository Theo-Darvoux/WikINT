# Upload Processing Pipeline (`api/app/workers/process_upload.py`)

## Purpose

This is the heart of the upload system. It runs as an ARQ background job, transforming a raw quarantine file into a clean, compressed, metadata-stripped file ready for use in pull requests. The pipeline emits real-time progress events via Redis pub/sub for the SSE endpoint.

## Pipeline Stages

```
┌─────────────────────────────────────┐    ┌───────────────┐    ┌───────────────┐
│  0. Scanning  ║  1. Stripping       │───▶│ 2. Compressing│───▶│ 3. Finalizing │
│   (40% wt)    ║   (25% wt)         │    │   (25% wt)    │    │   (10% wt)    │
│               ║                    │    │               │    │               │
│ YARA + Bazaar ║ EXIF, PDF          │    │ Ghostscript,  │    │ Upload to S3, │
│ + PDF safety  ║ Info, tags         │    │ ffmpeg, gzip  │    │ CAS entry     │
└─────────────────────────────────────┘    └───────────────┘    └───────────────┘
         ▲ Parallel (4.7)
```

**Stages 0 and 1 run in parallel** (Phase 6, item 4.7). The scan result is the security gate — if it reports malicious content, the strip result is discarded regardless of outcome. This reduces total pipeline time for the common CLEAN path.

Each stage has a weight that contributes to the `overall_percent` progress:
- Scanning: 40% (most time-consuming for large files)
- Stripping: 25%
- Compressing: 25%
- Finalizing: 10%

### Compression Optimizations (Phase 6)

- **Skip threshold (4.13):** Files smaller than 10 KiB are not compressed — the overhead exceeds the benefit.
- **Ghostscript quality (4.6):** Configurable via `GS_QUALITY` env var (default `/printer`). Higher quality means larger files but better fidelity. Options: `/screen`, `/ebook`, `/printer`, `/prepress`.
- **Video compression profiles:** Configurable via `VIDEO_COMPRESSION_PROFILE` env var (default `heavy`). Options: `none`, `light`, `medium`, `aggressive`, `heavy`, `extreme`.
- **Image format conversion:** Non-animated images are aggressively downscaled and transformed to `WEBP` format to minimize storage impact.

## Full Execution Flow

### Pre-Pipeline: CAS Deduplication Check (after download)

The worker checks CAS after download:

1. Download file from quarantine to temp directory + compute SHA-256 in one pass (`download_file_with_hash`)
2. Compute HMAC CAS key from SHA-256
3. Check Redis for CAS entry

**If CAS hit:**
- Copy the existing processed file to the new user's staging area
- Increment CAS reference count (atomic Lua script)
- Set scan/SHA-256 caches
- Update quota sorted set
- Emit CLEAN status
- Delete quarantine object
- **Skip the entire pipeline** (returns early)

**If CAS miss:** Continue to full pipeline.

### Disk Space Guard

Before downloading the file, the worker checks available disk space:
```python
usage = shutil.disk_usage(temp_dir)
required_free = int(initial_size * 2.0)  # 2.0x for processing headroom (Optimization 6.1)
if usage.free < required_free:
    raise RuntimeError(f"Insufficient disk space for {upload_id}")
```

This prevents a worker from filling up `/tmp` and crashing, which would orphan the quarantine file.

### Stage 0: Malware Scanning

1. Instantiate or reuse the `MalwareScanner`
2. Run YARA + MalwareBazaar scans concurrently with a 120-second timeout
3. **On timeout:** Emit FAILED status, return
4. **On malware detection:** Emit MALICIOUS status, return
5. For PDFs: Run `check_pdf_safety()` for auto-exec actions and embedded JavaScript
6. Emit progress: stage 0 complete

### Stage 1: Metadata Stripping

1. Call `strip_metadata_file(path, mime_type)` with a 60-second timeout
2. If the strip produces a new file (different path), swap it into the `ProcessingFile`
3. **On timeout:** Emit FAILED, return
4. **On ValueError:** This means auto-exec macros were detected → Emit MALICIOUS, return

### Stage 2: Compression

1. Determine compression timeout based on MIME category (15s for text, 30s for images, 60s for audio, 1200s for video)
2. Call `compress_file_path(path, mime_type, filename)` with the category-specific timeout
3. If compression produces a new file, swap it in
4. Track final MIME type and content encoding
5. **On failure:** Log warning, proceed with uncompressed file (fail-open for compression)

### Stage 3: Finalization

1. Determine canonical file extension from final MIME type
2. If extension changed (e.g., WAV → FLAC), rename the file
3. Construct final key: `uploads/{user_id}/{upload_id}/{safe_name}`
4. Upload processed file to S3 via `upload_file_multipart`
5. Compute content SHA-256 of the processed file
6. Set Redis caches:
   - Scan result cache (`CLEAN`, 24h TTL)
   - Per-user SHA-256 cache (24h TTL)
   - Global CAS entry (permanent, ref_count=1)
   - Quota sorted set entry
7. Emit CLEAN status with result data
8. Update upload DB row (clean, sha256, final_key)
9. Delete quarantine object
10. Record Prometheus metrics (pipeline duration, file size, compression ratio)
11. Optionally dispatch webhook

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

After a successful pipeline, `_maybe_dispatch_webhook` checks if the upload DB row has a `webhook_url`. If so, it enqueues a `dispatch_webhook` job. The webhook sends an HMAC-SHA256 signed POST request with the upload result data.

## Pipeline Checkpointing (Phase 2)

Each stage saves its completion to the DB via `_checkpoint_stage(ctx, upload_id, stage)`:

| After stage | `pipeline_stage` value |
|------------|----------------------|
| Scan complete | 1 |
| Strip complete | 2 |
| Compress complete | 3 |
| Finalize complete | — (status=clean) |

On ARQ retry, `_get_pipeline_stage(ctx, upload_id)` reads the DB. Stages with index < `completed_stage` are skipped with a log message. This makes the pipeline idempotent: a crash after scan but before strip retries from the strip stage.

The checkpoint is written using a bare SQLAlchemy `UPDATE` inside the worker's session factory, independent of the main pipeline transaction.

## Upload Cancellation (Phase 2)

`DELETE /api/upload/{upload_id}` (router: `upload/status.py`) sets `upload:cancel:{upload_id}` in Redis with a 1-hour TTL.

The worker calls `_check_cancelled(redis, upload_id)` at three points:
1. Before the pipeline starts (early cancellation)
2. After scan (between stages 0 and 1)
3. After strip (between stages 1 and 2)
4. After compress (between stages 2 and 3)

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

Admin endpoints (bureau/vieux roles only):
- `GET /api/admin/dlq` — paginated list, defaults to unresolved jobs
- `POST /api/admin/dlq/{id}/retry` — re-enqueues the job with original payload, marks resolved
- `POST /api/admin/dlq/{id}/dismiss` — marks resolved without retrying

A retried job that fails again creates a new DLQ entry (the original entry stays resolved).
