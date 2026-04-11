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

### Step 2.2: TUS Resumable Upload (Large files)
**Location:** `web/src/lib/upload-client.ts` → `api/app/routers/upload.py:patch_upload_chunk()`

1. **Initialization (`POST /api/upload/resumable`)**: Client declares total size and metadata. Server reserves quota and returns `Location` (TUS ID).
2. **Chunking (`PATCH /resumable/{id}`)**: Client sends chunks with `Upload-Offset`.
3. **Resiliency**:
    - **Atomic Lock**: A Redis lock (`tus:{id}`) ensures chunks are processed sequentially.
    - **Streaming to Disk**: Chunks are spooled directly to disk via `ProcessingFile` to avoid memory spikes.
    - **Early Checksum**: If `Upload-Checksum` is provided, the server verifies the chunk's SHA-1/MD5/SHA-256 while streaming. Incorrect checksums trigger immediate `460 Checksum Mismatch` rejection.
4. **Completion**: Once `Upload-Offset == Upload-Length`, the server finalizes the S3 multipart upload and enqueues the `process_upload` job.

---

### Step 2.3: Size and MIME Validation (Security Gate)
Regardless of the transfer method, the server performs a final validation after the file is assembled but **before** the worker starts:
- Fetch actual S3 size via `HEAD`.
- Verify per-category limits (e.g., 500 MiB for video).
- Correct MIME type via magic bytes (Range GET of first 2048 bytes).

**Location:** `api/app/workers/process_upload.py` (`process_upload()` entrypoint), `api/app/workers/upload/pipeline.py` (`UploadPipeline`), and `api/app/workers/upload/stages/`.

### Step 3.0: Setup
1. Extract and restore OpenTelemetry trace context.
2. Initialize `UploadWorkerRepository` (DB) and `UploadCacheRepository` (Redis).
3. Emit initial status: `PROCESSING, "Scanning for malware", stage_name="scan_strip"`.

### Step 3.1: Download & Validate
1. Check available disk space (require 2.0x file size free).
2. `run_download_and_validate()`: Download from quarantine + compute SHA-256 + validate MIME and size limits.
3. Create `ProcessingFile` wrapper around temp file.

### Step 3.2: CAS Check (Cross-User)
1. Compute HMAC CAS key from SHA-256.
2. `try_cas_short_circuit()`: Check Redis for existing CAS entry.
3. **If hit (and NOT stale):**
   - **Skip Malware Scan:** If the system has a valid CAS record, the file is trusted.
   - Increment Redis `ref_count` for the user's staging window.
   - Point the `Upload` row's `final_key` directly to `cas/{hmac}`.
   - Skip directly to clean status.
4. **If miss (or stale):** Continue to full processing.

### Step 3.3: Malware Scanning & Metadata Stripping (Stages 0-1, wt 55%)
1. `run_scan_and_strip()`: Dispatches both tasks concurrently via `asyncio.gather`.
2. **Malware Scan:** YARA + MalwareBazaar + PDF safety checks.
3. **Metadata Stripping:** Format-specific stripping (Images, PDF, Video, Audio, OOXML).
4. **Concurrency Logic:** If both fail, both are logged, but scan results (Detection/Malicious) always take precedence for the upload status.
5. If the pipeline resumes from a checkpoint where only the scan was finished, `run_strip_only()` is used.

### Step 3.4: Compression (Stage 2, weight 20%)
1. `run_compress_stage()`: Applies category-specific compression (WEBP for images, Ghostscript for PDF, FFmpeg for A/V).
2. **Fail-open:** If compression fails or times out, the uncompressed file is used.

### Step 3.5: Thumbnailing (Stage 3, weight 15%)
1. `run_thumbnail_stage()`: Dispatches to LibreOffice (Office documents), Ghostscript (PDF), FFmpeg (Video), or Pillow (Image).
2. **Artifact generated:** Resolves and outputs the WebP thumbnail, to be stored alongside the main file.
3. **Fail-open:** If thumbnail gen fails, no thumbnail is set but the file continues to finalization.

### Step 3.6: Finalization (Stage 4, weight 10%)
1. `run_finalize_storage()`: Uploads the processed file directly to `cas/{hmac}` (protected by a distributed Redis lock). **No uploads/ copy is created** (CAS V2).
2. Set Redis caches (Scan results, SHA-256 map, CAS entries, Quota).
3. Update DB via `UploadWorkerRepository`: set status=`clean`, final_key=`cas/{hmac}`, `thumbnail_key` if generated, and content_sha256.
4. Delete quarantine object and dispatch optional webhooks.

**Data at this point:**
```
S3: cas/{hmac} (single source of truth)
S3: quarantine/... DELETED
Redis: upload:scanned:{cas_key} = "CLEAN"
Redis: upload:cas:{hmac} = { final_key: "cas/...", mime_type, size, ref_count: 1 }
Redis: quota:uploads:{user_id} -> {staging:{user_id}:{upload_id}: timestamp}
DB: uploads row (status=clean, sha256, final_key=cas/{hmac})
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

   data: {"status":"clean","result":{"file_key":"cas/...","file_name":"notes.pdf","size":12345,"original_size":13000,"mime_type":"application/pdf","content_encoding":null}}
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
     "file_key": "cas/a03472e2061bc730e65ee763c886002eb1c93f37d69983f322cd79ecd5ce1464",
     "file_name": "notes.pdf",
     "file_size": 13000,
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
     - **No S3 copy needed** — `file_key` is already `cas/{hmac}` (CAS V2)
     - `increment_cas_ref` for the new MaterialVersion
     - Create `MaterialVersion` row with `file_key=cas/{hmac}`, `cas_sha256`
   - Create `Material` row with slug, tags, metadata
4. Transaction commits
5. Post-commit: ARQ jobs fire:
   - `index_material` — Add to MeiliSearch
   - Staging upload cleanup (decrement CAS ref for the staging window)

**Final data state:**
```
S3: cas/{hmac} (single source of truth, ref_count >= 1)
DB: materials row (with directory_id, slug, type)
DB: material_versions row (file_key=cas/{hmac}, cas_sha256, file_name, file_size, mime_type)
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
