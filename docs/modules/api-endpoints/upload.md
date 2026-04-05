# Upload Endpoints (`api/app/routers/upload/`, `api/app/routers/tus.py`)

## Overview

WikINT supports three upload methods, each suited for different file sizes and client capabilities:

1. **Direct Upload** (`POST /api/upload`) — Stream file through the API server. Simplest, good for files < 50 MiB.
2. **Presigned Upload** (`POST /api/upload/init` → PUT to S3 → `POST /api/upload/complete`) — Client uploads directly to S3. Better for larger files, bypasses API bandwidth. **Deprecated** (Sunset: 2027-01-01); use direct or TUS instead.
3. **TUS Resumable Upload** (`/api/tus/*`) — Resumable protocol for unreliable connections and very large files (up to 500 MiB).

All three methods converge on the same outcome: a file in `quarantine/` and an ARQ job enqueued for async processing.

### Path Selection

Use `GET /api/upload/config` to determine which upload path to use. The response includes:
- `recommended_path` — `"direct"` or `"tus"`
- `direct_threshold_mb` — files below this size (default 10 MiB) should use the direct path

Clients must not hard-code these thresholds; read them from the config endpoint at startup.

## Direct Upload (`POST /api/upload`)

**Response:** 202 Accepted with `UploadPendingOut`

### Flow

1. **Idempotency check:** If `X-Upload-ID` header present, check Redis for a cached result
2. **Quota check:** Verify user hasn't exceeded pending upload cap (50 regular / 200 privileged). Uses atomic Redis pipeline (ZADD + ZCARD) to prevent TOCTOU races.
3. **Filename validation:** Sanitize filename, check extension whitelist (max 255 chars)
4. **Stream to temp file:** `ProcessingFile.from_upload()` spools the upload to disk with size enforcement
5. **Magic byte detection:** Read first 8192 bytes, run `guess_mime_from_bytes()`
6. **MIME consistency check:** Verify magic bytes match the file extension
7. **Per-type size limit check:** Enforce category-specific size caps
8. **SVG safety check:** If SVG, run `check_svg_safety()` inline (SVGs are small enough)
9. **SHA-256 computation:** Always computed; used for idempotency and CAS dedup
10. **Upload to quarantine:** Stream to `quarantine/{user_id}/{upload_id}/{filename}` (only if CAS miss)
11. **Create upload DB row:** Best-effort persistence for lifecycle tracking
12. **Enqueue processing:** ARQ job on fast or slow queue based on file size
13. **Cache idempotency key:** If `X-Upload-ID` was provided
14. **Return 202** with upload_id and quarantine file_key

### Queue Routing

```python
_FAST_QUEUE_THRESHOLD = 5 * 1024 * 1024  # 5 MiB
queue_name = _FAST_QUEUE_NAME if file_size < _FAST_QUEUE_THRESHOLD else _SLOW_QUEUE_NAME
```

This separation ensures a 100 KB PDF upload isn't blocked behind a 200 MiB video in the processing queue.

## Presigned Upload

### `POST /api/upload/init`

**Deprecated** — response includes `Deprecation: true`, `Sunset: Sat, 01 Jan 2027 00:00:00 GMT`, and `Link: </api/upload>; rel="successor-version"` headers.

**Input:** `UploadInitRequest { filename, size, mime_type, sha256? }`
**Output:** `PresignedUploadOut { upload_url, file_key, upload_id }`

1. Validate filename and MIME type
2. Enforce `ContentLength` as a signed S3 header (prevents oversized uploads)
3. Check per-type size limits
4. Reserve quota slot (atomic ZADD + ZCARD)
5. Generate quarantine key
6. Store upload intent in Redis (`upload:intent:{key}`, 1h TTL) with expected filename, MIME, and optional SHA-256
7. Generate presigned PUT URL via `generate_presigned_put()`
8. Return the URL for the client to PUT directly to S3

### `POST /api/upload/complete`

**Input:** `UploadCompleteRequest { file_key, checksum? }`

1. Validate the intent exists in Redis (prevents completing an upload that was never initiated)
2. Verify the file exists in S3 (HEAD request)
3. **MIME re-validation:** Range GET first 2048 bytes, run `guess_mime_from_bytes()` + `_apply_mime_correction()`
4. Burn the intent key (single-use)
5. Enqueue processing ARQ job (worker verifies SHA-256 if provided in intent)
6. Return 202 with upload status

### Presigned Multipart

For files > `MULTIPART_THRESHOLD` when `enable_presigned_multipart` is enabled:

1. `POST /api/upload/init-multipart` — Initiates S3 multipart upload, returns presigned URLs for each part
2. Client PUTs each part directly to S3 (concurrently using bounded Promise.all pools for maximum throughput)
3. `POST /api/upload/complete-multipart` — Completes the S3 multipart upload. The intent is consumed atomically via Redis `GETDEL` (prevents double-completion races). The server fetches the true assembled size from S3 via HEAD request to validate per-type size limits against the actual object size rather than the client-declared value.

## TUS Resumable Upload (`/api/tus/*`)

Implements a subset of the [TUS protocol](https://tus.io/protocols/resumable-upload) for resumable uploads.

### Key TUS Concepts
- **Creation:** `POST /api/tus/` with `Upload-Length` and `Upload-Metadata` headers
- **Patching:** `PATCH /api/tus/{upload_id}` with `Upload-Offset` header
- **Head:** `HEAD /api/tus/{upload_id}` to query current offset (for resume)
- **Checksum:** Optional `Upload-Checksum` header for integrity verification

### TUS Configuration
- Minimum chunk: 5 MiB (S3 multipart minimum)
- Maximum chunk: 100 MiB
- Maximum file size: 500 MiB
- Concurrent uploads per user: 8

### TUS Implementation Details

The TUS router manages the mapping between TUS protocol state and S3 multipart uploads:
- Each TUS upload corresponds to an S3 multipart upload.
- Each PATCH request uploads one S3 part.
- Upload state (offset, part ETags) is tracked in Redis.
- On completion, the S3 multipart upload is finalized and processing is enqueued. If the enqueue step fails (e.g. Redis blip), subsequent retry requests will gracefully recover by detecting the `NoSuchUpload` AWS error, verifying the object exists in S3, and re-attempting the enqueue without deadlocking.

#### Client-Side Resumption
TUS 1.0.0 enables large file resumption if the page is refreshed or the browser crashes:
- The client persists the `tusUrl` in browser `localStorage`.
- Upon retry, the client sends a `HEAD` request to the server to query the current `Upload-Offset`.
- The server maintains a **24-hour TTL** for TUS session state in Redis. If the session has expired, the client must restart the upload.

## Upload Progress SSE (`GET /api/upload/events/{file_key}`)

Real-time upload processing progress via Server-Sent Events:

1. Authenticate via `Authorization: Bearer` header (fetch-based SSE, not native EventSource)
2. **Concurrency limit:** Max 10 concurrent SSE streams per user. The 11th concurrent request returns 429. The concurrency counter is incremented eagerly at the endpoint level (for fast rejection) and decremented inside the generator's `finally` block (so it tracks the actual stream lifetime, not just the endpoint call).
3. Check Redis for cached terminal status (immediate short-circuit on reconnect)
4. Replay event log from Redis list from `Last-Event-ID` (for events missed between status checks)
5. Subscribe to Redis pub/sub channel for live events
6. Stream events until terminal state (clean/malicious/failed) or 10-minute timeout
7. Send keepalive pings every **15 seconds** (`ping` event type, empty data)
8. Decrement the active-stream counter when the connection closes

**Event format:**
```json
{
  "upload_id": "...",
  "file_key": "quarantine/...",
  "status": "processing",
  "detail": "Scanning for malware",
  "stage_index": 0,
  "stage_total": 4,
  "stage_percent": 0.5,
  "overall_percent": 0.20
}
```

## Upload Status Polling (`GET /api/upload/status/{file_key}`)

Fallback for clients that don't support SSE. Returns the latest cached status from Redis.

## Upload Status Polling (`GET /api/upload/status/{file_key}`)

Non-SSE fallback for clients that don't support streaming. Returns the latest cached status from Redis. Returns `PENDING` if no status has been written yet.

## Batch Status Polling (`POST /api/upload/status/batch`)

Poll up to 50 file keys in a single request. Ownership is enforced: keys not prefixed with `quarantine/{user_id}/` or `uploads/{user_id}/` are silently omitted. Unknown keys return `status: pending`.

**Input:** `{ "file_keys": ["quarantine/...", ...] }` (max 50)
**Output:** `{ "statuses": { "<key>": { "status": "...", ... } } }`

## Upload History (`GET /api/upload/mine`)

Returns the authenticated user's paginated upload history, all statuses included, newest first.

**Query params:** `page` (default 1), `limit` (default 20, max 100)
**Output:** `{ "items": [...], "total": N, "page": P, "pages": P }`

## Upload Configuration (`GET /api/upload/config`)

Returns allowed extensions, MIME types, size limits, and path selection hints. No authentication required.

```json
{
  "allowed_extensions": [".pdf", ".png", ...],
  "allowed_mimetypes": ["application/pdf", "image/png", ...],
  "max_file_size_mb": 100,
  "recommended_path": "direct",
  "direct_threshold_mb": 10
}
```

Clients should read `recommended_path` and `direct_threshold_mb` at startup instead of hard-coding thresholds.

## Upload Cancellation (`DELETE /api/upload/{upload_id}`)

Sets a Redis cancellation flag (`upload:cancel:{upload_id}`, 1h TTL), deletes the quarantine object from S3, and removes the entry from the user's quota sorted set. Idempotent — returns 204 even if the upload_id is not found.

The background worker checks the cancellation flag between pipeline stages and aborts if set.

## CAS Deduplication Check (`POST /api/upload/check-exists`)

**Input:** `CheckExistsRequest { sha256 }`

Checks if a file with the given SHA-256 has already been processed and is available. If yes, the client can skip the upload entirely. The check uses the HMAC-keyed CAS key to prevent cross-user probing.

**Privacy isolation:** The endpoint first checks the user's personal upload cache (`upload:sha256:{user_id}:{sha256}`). If no per-user hit is found, it falls back to the global CAS index. On a CAS hit, the response returns `exists=True` with `file_key=None` — the raw `cas/` internal storage key is never exposed to the client. The upload flow's CAS-hit path handles copying from the global CAS prefix to the per-user prefix transparently.
