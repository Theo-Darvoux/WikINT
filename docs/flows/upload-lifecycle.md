# Upload Lifecycle Flow

## Overview

This document traces the complete lifecycle of a file from the moment a user drops it in the browser to when it becomes a downloadable material attached to an approved pull request.

## Phase 1: Client-Side Preparation

```
User Action: Drop file onto page / click upload button
```

### Step 1.1: Client Validation
**Location:** `web/src/lib/file-utils.ts`, `web/src/lib/upload-client.ts`

1. Extract filename and extension
2. Check extension against `ALLOWED_EXTENSIONS` whitelist
3. Check file size against per-type limits (mirrored from server config)
4. If validation fails: show error toast, stop

### Step 1.2: SHA-256 Hashing
**Location:** `web/src/lib/crypto-utils.ts`

1. Read file into `ArrayBuffer`
2. Compute SHA-256 via `crypto.subtle.digest()`
3. Convert to hex string

### Step 1.3: CAS Deduplication Check
**Location:** `web/src/lib/upload-client.ts`

1. `POST /api/upload/check-exists` with `{ sha256 }`
2. Server computes HMAC CAS key, checks Redis
3. **If hit:** Return existing `file_key` immediately. Skip upload entirely.
4. **If miss:** Continue to upload.

**Data at this point:**
```
file: File object in browser memory
sha256: "a1b2c3..."
```

## Phase 2: File Transfer

### Step 2.1: Direct Upload (files < 50 MiB)
**Location:** `web/src/lib/upload-client.ts` → `api/app/routers/upload.py:upload_file()`

1. Client: `POST /api/upload` with file as `multipart/form-data`
   - Header: `Authorization: Bearer <jwt>`
   - Header: `X-Upload-ID: <idempotency-key>` (optional)
2. Server: Extract `UploadFile` from request
3. Server: Check idempotency key in Redis (if provided)
4. Server: `_check_pending_cap()` — Verify user hasn't exceeded quota (50/200 pending)
   - Atomic Redis pipeline: ZADD + ZCARD on `quota:uploads:{user_id}`
5. Server: `_validate_filename()` — Sanitize filename, check extension
6. Server: `ProcessingFile.from_upload()` — Stream to temp file on disk
   - If Starlette spooled to disk: `shutil.copyfile` (fast path)
   - If in memory: chunked read (1 MiB chunks)
   - Size enforcement during streaming
7. Server: Read first 8192 bytes → `guess_mime_from_bytes()` → magic byte detection
8. Server: `_apply_mime_correction()` — Verify magic bytes match extension
9. Server: `_check_per_type_size()` — Category-specific size limit
10. Server: SVG safety check (if SVG)
11. Server: SHA-256 computation (for idempotency and CAS dedup)
12. Server: CAS check — if hit, verify staleness (`scanned_at` timestamp) and **re-scan** against current YARA rules before accepting
13. Server: Upload to S3: `quarantine/{user_id}/{upload_id}/{filename}` (CAS miss only)
13. Server: Create `Upload` DB row (status=pending)
14. Server: Enqueue ARQ job (`process_upload`) on MIME-priority queue (fast queue for text/images, heavy queue for video/pdf/archive, size fallback for others)
15. Server: Return `202 Accepted` with `{ upload_id, file_key }`

**Data at this point:**
```
S3: quarantine/{user_id}/{upload_id}/{filename} (raw file)
Redis: quota:uploads:{user_id} → {quarantine_key: timestamp}
DB: uploads row (status=pending)
ARQ: process_upload job enqueued
```

## Phase 3: Background Processing

**Location:** `api/app/workers/process_upload.py:process_upload()`

### Step 3.0: Setup
1. Extract and restore OpenTelemetry trace context
2. Set up Redis status/event publishing functions
3. Emit initial status: `PROCESSING, "Scanning for malware", stage=0`

### Step 3.1: Download & Hash
1. Check available disk space (require 1.5x file size free)
2. `download_file_with_hash()` — Download from quarantine + compute SHA-256 in one pass
3. Create `ProcessingFile` wrapper around temp file

### Step 3.2: CAS Check (Cross-User)
1. Compute HMAC CAS key from SHA-256
2. Check Redis for existing CAS entry
3. **If hit:** 
   - Check if the S3 master object exists in `cas/` prefix.
   - If yes: Copy the master file to user's `uploads/`, increment Redis `ref_count`, and skip to finalization.
   - If no: Log warning and continue to full processing.
4. **If miss:** Continue

### Step 3.3: Malware Scan (Stage 0, weight 40%)
1. YARA scan (in thread executor, timeout: yara_scan_timeout + 5s)
2. MalwareBazaar API check (concurrent with YARA)
3. Both results checked:
   - Exception → `FAILED` (fail-closed)
   - Detection → `MALICIOUS`
   - Clean → continue
4. For PDFs: `check_pdf_safety()` — /OpenAction, /AA, /JavaScript
5. Emit: stage 0 complete (40% overall)

### Step 3.4: Metadata Stripping (Stage 1, weight 25%)
1. `strip_metadata_file(path, mime_type)` — Dispatches to format-specific handler:
   - Images: Pillow re-save (strip EXIF)
   - PDF: pikepdf (strip /Info, XMP, active content)
   - Video: ffmpeg `-map_metadata -1` (sandboxed)
   - Audio: mutagen tag deletion
   - OLE2: oletools macro check + exiftool (sandboxed)
   - OOXML: ZIP reconstruction without docProps/
2. If handler produces new file: `pf.replace_with(new_path)`
3. Emit: stage 1 complete (65% overall)

### Step 3.5: Compression (Stage 2, weight 25%)
1. `compress_file_path(path, mime_type, filename)`:
   - Images: Resize to max 2048px (2K) and heavily compress to WEBP format (animated GIFs bypass format conversion)
   - Video: FFmpeg configurable re-encode governed by `video_compression_profile` setting (default 'heavy')
   - PDF: Ghostscript with /prepress quality (configurable, sandboxed)
   - Audio: FFmpeg conversion to Opus (lossy)
   - SVG: scour optimization
   - Text/JSON/XML: gzip compression
   - ZIP formats: re-deflate
   - Already-compressed formats: skip
2. Per-category timeout (15s text, 1200s video)
3. **On failure: fail-open** — proceed with uncompressed file
4. Track final MIME type and content encoding
5. Emit: stage 2 complete (90% overall)

### Step 3.6: CAS Promotion (Stage 3, weight 5%)
1. Compute content SHA-256 of processed file.
2. Construct CAS S3 key: `cas/{hmac_cas_key_suffix}`.
3. Acquire a distributed Redis lock to prevent concurrent workers from uploading the exact same file.
4. If lock acquired, check if CAS master exists in S3. If not: `upload_file_multipart` processed file to `cas/` prefix.
5. If lock NOT acquired, wait up to 60s for the lock holder to finish. If the lock holder fails, gracefully fail open (skip global CAS promotion) and use the user's personal final_key to prevent concurrent S3 multipart corruption.

### Step 3.7: Finalization (Stage 3, weight 5%)
1. Determine canonical extension from final MIME type.
2. Construct final user key: `uploads/{user_id}/{upload_id}/{safe_name}`.
3. `upload_file_multipart` processed file to user's prefix (for PR compatibility).
4. Set Redis caches:
   - `upload:scanned:{final_key}` → "CLEAN" (24h TTL)
   - `upload:sha256:{user_id}:{sha256}` → final_key (24h TTL)
   - `upload:cas:{hmac}` → JSON entry pointing to `cas/` key, `ref_count: 1` (permanent)
   - `quota:uploads:{user_id}` → {final_key: timestamp}
5. Emit: `CLEAN` with result `{ file_key, size, original_size, mime_type }`
6. Update DB: upload status=clean, sha256, final_key
7. Delete quarantine object from S3
8. Record Prometheus metrics

**Data at this point:**
```
S3: cas/{hmac} (master copy)
S3: uploads/{user_id}/{upload_id}/{filename} (processed, clean)
S3: quarantine/... DELETED
Redis: upload:scanned:{key} = "CLEAN"
Redis: upload:cas:{hmac} = { final_key: "cas/...", mime_type, size, ref_count: 1 }
DB: uploads row (status=clean, sha256, final_key)
```

## Phase 4: SSE Progress Tracking (Concurrent with Phase 3)

**Location:** `api/app/routers/upload.py:upload_events()`, `web/src/lib/sse-client.ts`

1. Client opens `GET /api/upload/events/{quarantine_key}?token=<jwt>`
2. Server authenticates via query param JWT
3. Server checks Redis for cached status (immediate catch-up)
4. Server replays event log from Redis list
5. Server subscribes to `upload:events:{quarantine_key}` pub/sub channel
6. Server streams events as they arrive:
   ```
   data: {"status":"processing","detail":"Scanning for malware","overall_percent":0.2}

   data: {"status":"processing","detail":"Removing private metadata","overall_percent":0.65}

   data: {"status":"clean","result":{"file_key":"uploads/...","size":12345}}
   ```
7. Client updates progress bar and status text
8. On terminal event: close SSE connection

## Phase 5: PR Staging & Creation

**Location:** `web/src/lib/staging-store.ts`, `web/src/app/pull-requests/new/page.tsx`

1. Client adds operation to staging store:
   ```json
   {
     "op": "create_material",
     "title": "Lecture Notes",
     "directory_id": "uuid",
     "type": "pdf",
     "file_key": "uploads/{user_id}/{upload_id}/notes.pdf",
     "file_name": "notes.pdf",
     "file_size": 12345,
     "file_mime_type": "application/pdf"
   }
   ```
2. Operation persists to localStorage with `stagedAt` timestamp
3. User adds more operations (more uploads, folder creation, edits)
4. User opens PR creation wizard
5. User provides title and description
6. `POST /api/pull-requests` with payload = staged operations

## Phase 6: PR Approval & Publication

**Location:** `api/app/routers/pull_requests.py`, `api/app/services/pr.py`

1. Moderator reviews PR, clicks Approve
2. `POST /api/pull-requests/{id}/approve`
3. `apply_pr(db, pr, user_id)`:
   - Topological sort of operations
   - For each `create_material` with `file_key`:
     - `copy_object(uploads/..., materials/...)` — Copy to permanent prefix
     - Schedule post-commit delete of `uploads/...` copy
     - Create `MaterialVersion` row
   - Create `Material` row with slug, tags, metadata
4. Transaction commits
5. Post-commit: ARQ jobs fire:
   - `index_material` — Add to MeiliSearch
   - `delete_storage_objects` — Remove staging files (CAS-aware: decrements `ref_count` if key is in `cas/` prefix; only deletes S3 object if count hits 0).

**Final data state:**
```
S3: cas/{hmac} (master copy, preserved if ref_count > 0)
S3: materials/{user_id}/{upload_id}/{filename} (permanent)
S3: uploads/... DELETED (post-commit cleanup)
DB: materials row (with directory_id, slug, type)
DB: material_versions row (file_key, file_size, mime_type, virus_scan_result=clean)
MeiliSearch: indexed for full-text search
```

## Upload Cancellation

A user can cancel a pending or in-progress upload:
```
DELETE /api/upload/{upload_id}
```

This sets `upload:cancel:{upload_id}` in Redis (1h TTL). The worker checks this flag before the pipeline starts and after each stage. On detection, the status is set to `cancelled` and the quarantine file is deleted. The endpoint also removes the S3 object and quota entry immediately, regardless of worker state.

## Error Recovery Points

| Phase | Failure | Recovery |
|-------|---------|----------|
| Phase 2 | Network error | Client retries with same X-Upload-ID (idempotent) |
| Phase 3 | Worker crash mid-stage | ARQ retries; `pipeline_stage` checkpoint skips completed stages |
| Phase 3 | Worker exhausts retries | Job inserted into `dead_letter_jobs`; the orphaned quarantine object is immediately deleted from S3 to prevent storage leakage; admin can retry/dismiss via `/api/admin/dlq` |
| Phase 3 | Malware detected | File stays in quarantine for forensics |
| Phase 3 | User cancels | Worker checks Redis flag between stages; quarantine file deleted |
| Phase 5 | Upload expired (24h) | Client shows warning, user must re-upload |
| Phase 6 | PR commit fails | Transaction rolls back, uploads/ files preserved |
| Phase 6 | Post-commit job fails | Cleanup worker catches orphaned files later |
