# Upload Hardening

## Defense-in-Depth Layers

Every uploaded file passes through multiple security gates before it can be served to any user:

```
Client Upload → Quarantine → YARA Scan → MalwareBazaar → PDF Safety Check
    → Metadata Strip → Compression → Staging (uploads/) → PR Approval → Published (materials/)
```

No shortcut exists. Even if a bug in the upload router somehow skipped validation, the `generate_presigned_get()` function contains a hard-coded check that refuses to generate download URLs for any key starting with `quarantine/`.

## Quarantine Pattern

All uploaded files land in the `quarantine/` S3 prefix. They are **never directly accessible** to users. The worker pipeline is the only path from quarantine to the `uploads/` prefix.

**Key insight:** The quarantine key contains the user ID and upload ID, making it traceable. If malware is detected, the quarantine object is preserved for forensic analysis (it is not automatically deleted).

## Malware Scanning (`api/app/core/scanner.py`)

### MalwareScanner Class

The scanner is instantiated once during app startup and stored in `app.state.scanner`. It holds:
- Compiled YARA rules (from the `yara_rules/` directory)
- A persistent `httpx.AsyncClient` for MalwareBazaar API calls

### Dual-Engine Scanning

YARA and MalwareBazaar scans run **concurrently** via `asyncio.gather`:

```python
yara_result, bazaar_result = await asyncio.gather(
    self._scan_yara(file_bytes, filename),
    self._check_malwarebazaar(sha256, filename),
    return_exceptions=True,
)
```

Using `return_exceptions=True` means both scans complete even if one fails. The results are then checked:

1. **If either scan raised an exception:** The upload is rejected (fail-closed). The error message says "temporarily unavailable" rather than exposing internal details.
2. **If either scan detected a threat:** The upload is rejected with `ERR_MALWARE_DETECTED`.
3. **If both return None:** The file is clean.

### YARA Scanning

- Rules are compiled from all `.yar`/`.yara` files in `yara_rules_dir`
- Scanning runs in a thread executor to avoid blocking the event loop
- Double timeout: `asyncio.wait_for` wraps the executor call with `yara_scan_timeout + 5` seconds, while YARA itself has its own timeout
- Both in-memory (`scan_file`) and on-disk (`scan_file_path`) variants exist

### MalwareBazaar Integration

Queries the abuse.ch MalwareBazaar API by SHA-256 hash:
- `hash_not_found` / `no_results` → clean
- `ok` → known malware, extract signature name
- Timeout/HTTP error → controlled by `malwarebazaar_fail_closed` setting:
  - `true` (default): Propagate exception → fail-closed
  - `false`: Log warning, return None (YARA is authoritative)

### Backward Compatibility

The module maintains a `scan_file(bytes)` wrapper that is deprecated in favor of `scan_file_path(Path)`. The bytes version loads the entire file into memory and is unsuitable for large files. A `DeprecationWarning` is emitted when called.

## Content-Addressable Storage (CAS) Deduplication

### HKDF-Keyed CAS (`api/app/core/cas.py`)

The CAS key is derived from the file's SHA-256 hash using HKDF (HMAC-based Key Derivation Function):

```python
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

# Derived once at module load, cached for performance
_hkdf = HKDF(algorithm=hashes.SHA256(), length=32, info=b"wikint-cas-v1", salt=None)
_cas_signing_key = _hkdf.derive(settings.secret_key.get_secret_value().encode())

def hmac_cas_key(sha256: str) -> str:
    digest = hmac.new(_cas_signing_key, sha256.encode(), hashlib.sha256).hexdigest()
    return f"upload:cas:{digest}"
```

**Why HKDF instead of raw HMAC with the secret key?** HKDF provides proper key derivation with domain separation (the `info=b"wikint-cas-v1"` label). This prevents cross-protocol attacks where the same `SECRET_KEY` is reused across different subsystems (e.g., JWT signing, CAS keys). The derived key is purpose-specific and isolated.

**Why not plain SHA-256?** A plain SHA-256 key would allow cross-user probing: if User A knows the SHA-256 of a file, they could check whether User B has already uploaded it. The HMAC key is derived from a secret, making it unpredictable to users.

**Privacy Isolation:** The `POST /api/upload/check-exists` endpoint first checks the authenticated user's personal upload cache. If no per-user hit is found, it falls back to the global CAS index — but on a CAS hit, the response returns `exists=True` with `file_key=None` (the raw `cas/` internal storage key is never exposed). The upload flow's CAS-hit path handles the copy from the global CAS prefix to the per-user prefix transparently. This prevents both existence probing side-channels and internal storage path leakage.

**Migration note:** Changing the key derivation invalidates all existing CAS entries. They become orphaned and are cleaned up naturally by the existing cleanup job.

### Deduplication Flow

1. Worker downloads file from quarantine, computes SHA-256
2. Computes HMAC CAS key, checks Redis
3. **CAS hit:** Verify the entry is not stale (`scanned_at` must be present and within `cas_max_age_seconds`). Re-scan the file against current YARA rules to ensure detection signatures haven't been updated since the CAS entry was created. Copy the existing processed file to the new user's staging area. Increment `ref_count` atomically (Lua script).
4. **CAS miss:** Run full pipeline. On success, write CAS entry with `ref_count: 1` and `scanned_at` timestamp.

CAS entries persist indefinitely in Redis (no TTL). They are removed when `ref_count` drops to 0 via the `_LUA_CAS_DECR` script.

## Upload Quota Enforcement

### Per-User Quota

Each user has a Redis sorted set `quota:uploads:{user_id}` where members are S3 keys and scores are timestamps.

**Caps:**
- Regular users: 50 pending uploads
- Privileged users (member/bureau/vieux): 200 pending uploads

**Anti-TOCTOU race condition:** The quota check and reservation are done atomically via a Redis pipeline:

```python
async with redis.pipeline() as pipe:
    pipe.zadd(quota_key, {reserve_key: time.time()})
    pipe.zcard(quota_key)
    results = await pipe.execute()
count = results[1]
if count > cap:
    await redis.zrem(quota_key, reserve_key)
    raise BadRequestError(...)
```

This ensures two concurrent uploads can't both pass the quota check.

**Stale entry cleanup:** Entries older than 25 hours are automatically removed via `zremrangebyscore` before each check.

**Permissive fallback:** If Redis is unreachable, the upload proceeds rather than blocking legitimate users over an infra glitch.

## Filename Sanitization

`_sanitize_filename()` strips:
- Control characters (`\x00-\x1f`, `\x7f`)
- Unicode trickery (zero-width spaces, bidirectional overrides, line/paragraph separators)
- Shell-special characters (`# % & { } \ < > * ? / $ ! ' " : @ + \` | = ^ ~ [ ]`)
- Path traversal (extracts basename, collapses multiple underscores, strips leading/trailing dots)

**Length limit:** Filenames are capped at 255 characters (`_MAX_FILENAME_LENGTH`). This prevents filesystem-level issues (ext4 NAME_MAX is 255 bytes) and S3 key bloat. Exceeding this limit raises `BadRequestError` with `ERR_FILENAME_TOO_LONG`.

## MIME Type Enforcement

The upload endpoint enforces MIME types at three levels:

1. **Extension whitelist:** The file extension must be in `ALLOWED_EXTENSIONS`
2. **Magic byte detection:** The first 8192 bytes are inspected to determine the actual file type
3. **Extension-MIME consistency:** If the extension is `.png` but magic bytes say `image/jpeg`, the upload is rejected (`ERR_MIME_MISMATCH`). This prevents extension spoofing.

## Per-Category Size Limits

Size limits are enforced server-side before any processing begins:

```python
_PER_TYPE_LIMITS = {
    "image/svg+xml": 5 MiB,
    "image/": 50 MiB,
    "audio/": 200 MiB,
    "video/": 500 MiB,
    "application/pdf": 200 MiB,
    "text/": 10 MiB,
    ...
}
```

The matching logic tries exact MIME match first, then prefix match. The global `max_file_size_mb` acts as a fallback ceiling.

## Idempotency

The `X-Upload-ID` header enables idempotent uploads:
- If the same upload ID is sent twice, the second request returns the cached result instead of creating a duplicate
- **Tenant Isolation**: The Redis idempotency cache key is strictly namespaced with the authenticated user's ID (`upload:idem:{user_id}:{upload_id}`). This prevents IDOR attacks where an attacker could guess another user's `X-Upload-ID` to steal their `file_key` and upload status.
- Idempotency keys are stored in Redis with a 25-hour TTL (slightly longer than the 24-hour file expiry)

## Pipeline Deadline

The entire upload pipeline has a hard deadline (`upload_pipeline_max_seconds`, default 600 seconds). Each stage checks the elapsed time and fails the job if the deadline is exceeded. This prevents runaway Ghostscript or FFmpeg processes from blocking the worker indefinitely.

## Polyglot File Detection (`api/app/core/polyglot.py`)

A polyglot file is simultaneously valid under two or more format parsers. Attackers use polyglots to bypass MIME-based checks — for example, a file that passes as a JPEG but also embeds a ZIP archive (JZBOMB), or a PDF that starts with PE executable magic.

`check_polyglot(file_path, detected_mime)` runs **after** MIME detection and **before** the malware scan. It performs two structural checks:

1. **Header magic cross-check**: The first 256 bytes are checked against a list of known format magic bytes. If the header matches a magic pattern incompatible with `detected_mime`, the file is rejected as MALICIOUS.

2. **ZIP tail check**: ZIP archives append a 22-byte End-of-Central-Directory (EOCD) record at the end. A non-archive file (image, PDF, text) containing this signature in its last 256 bytes is flagged as a polyglot. This catches the JZBOMB and PDF+ZIP patterns.

Format families that are expected for a given MIME type (e.g. PDF magic in `application/pdf`) are whitelisted to avoid false positives. On read error, the check **fails closed** (raises `ValueError`) to prevent unverified files from bypassing structural analysis.

## TUS Resumable Upload Hardening

### Memory Exhaustion / Chunk DoS Protection
Before reading any chunk data into memory during a `PATCH` request, the router enforces a strict, atomic `inflight` limit per user (`upload:inflight:{user_id}`). This ensures a malicious user cannot open thousands of concurrent chunk uploads to exhaust server RAM. 

Furthermore, incoming chunk data is spooled directly to a temporary file on disk rather than being buffered in memory. This ensures that even large chunks (up to `tus_chunk_max_bytes`) do not cause memory spikes or OOM errors on the API server.

### Concurrent Chunk Integrity (Race Condition Prevention)
While the `inflight` limit protects global memory, individual TUS sessions are protected by a distributed Redis lock (`redis_lock(redis, f"tus:{tus_id}", timeout=120.0)`). This guarantees that multiple `PATCH` requests for the *same* upload ID are processed strictly sequentially, preventing race conditions from corrupting the `Upload-Offset` or S3 multipart state.

If a client sends an incorrect `Upload-Offset`, the server responds with `409 Conflict` per the TUS 1.0.0 specification, allowing compatible clients (like `tus-js-client`) to automatically query the correct offset and resume.

### Early Checksum Verification
If an `Upload-Checksum` header is provided, the payload is hashed dynamically as it streams into memory. The hash is validated *before* the Redis state lock is acquired and *before* any data is sent to S3. This prevents malicious or corrupted chunks from advancing the `Upload-Offset` or wasting S3 bandwidth.

### Orphaned Multipart Cleanup
If a TUS upload is terminated via `DELETE`, or if the final S3 `complete_multipart_upload` call fails, the server proactively calls `abort_multipart_upload` to instruct S3 to delete all unfinalized parts, preventing orphaned storage accumulation.

## Presigned Upload Hardening

### Content-Length Enforcement (1.2)

`generate_presigned_put` passes `ContentLength` to the S3 `put_object` presigned URL and adds a `content-length-range` condition. Clients cannot upload more or fewer bytes than declared in the upload intent.

### MIME Re-Validation on Complete (1.3)

When `POST /upload/complete` is called, the worker reads the first 2048 bytes from the quarantine object via a Range GET and runs `_apply_mime_correction`. If the magic bytes contradict the client-declared MIME type, the corrected MIME is stored in the intent and forwarded to the processing worker.

### Atomic Intent Consumption (Audit Review Fix)

The presigned multipart complete endpoint uses Redis `GETDEL` to atomically retrieve and delete the upload intent in a single command. This prevents a race condition where two concurrent `POST /complete` requests could both read the same intent and double-process the upload.

### Server-Side Size Validation (Audit Review Fix)

After completing an S3 multipart upload, the presigned complete endpoint fetches the actual assembled object size from S3 via a HEAD request (`get_object_info`). Per-type size limits are enforced against this **actual** size rather than the client-declared size, preventing size spoofing.

### SHA-256 Integrity (1.15)

`UploadInitRequest` accepts an optional `sha256` field. If provided, it is stored in the Redis upload intent and passed to the background worker as `expected_sha256`. The worker verifies the hash after downloading the quarantine file and rejects the upload if there is a mismatch.

## Outbound URL Validation / SSRF Prevention (`api/app/core/url_validation.py`)

`is_safe_url(url)` validates any user-supplied URL before the server makes an outbound HTTP request. Rules:

- Scheme must be `https` (plain HTTP is blocked)
- Hostname must resolve to a public IP — loopback (127.x, ::1), private RFC-1918 ranges, and link-local addresses (169.254.x.x, fe80::/10) are blocked
- DNS resolution failures are treated as blocked (fail-closed)

Used by `webhook_dispatch.py` before dispatching signed upload-complete webhooks.

## Error Response Format (3C)

All `AppError` responses (400/401/403/404/409/429/503) are formatted as:

```json
{
  "error_code": "<machine-readable code or null>",
  "error_message": "<human-readable description>",
  "detail": "<same as error_message — backward compat>"
}
```

`error_code` is always present, even when no specific code is set (it will be `null`). This allows clients to reliably destructure the error shape without checking for key existence.

## Content Disposition on Download

`generate_presigned_get` defaults to `force_download=True`, which sets `ResponseContentDisposition: attachment` on the presigned S3 URL. This prevents browsers from rendering uploaded content inline for all file types except images and PDFs.

The `/api/materials/{id}/inline` endpoint passes `force_download=False` only for MIME types starting with `image/` or equal to `application/pdf`. All other types are forced to download even from the inline endpoint.

## Resiliency and Resource Hardening (Audit v2)

1. **SSE Leak Protection**: Pre-generator logic drops rate limiting counters gracefully if network issues or parsing fails before the stream begins.
2. **Terminal State Break**: Hard failures ("failed" or "malicious") emit terminal exceptions in `upload-client.ts`, halting 10-retry loop to prevent connection thrashing. 
3. **CAS Concurrency Safety**: In case of a worker crash holding a CAS promotion lock, secondary workers gracefully fail open after 60 seconds. They skip the global CAS upload to prevent split-brain S3 corruption and rely solely on the user's personal staging key.
4. **I/O Starvation**: Object reading and disk writing logic utilizes `asyncio.to_thread` for operations like AWS download chunks and intensive XML parsing (e.g. SVG safety checks), keeping the event-loop active and reducing connection stalls on large video or binary files.
5. **Periodic GC**: Short-lived `pending` orphan uploads (often arising from presigned intent abandoned by the client) are scrubbed every 2 hours alongside old pull-requests.
6. **Disk Space Guard**: Before downloading a file from quarantine for scanning, the worker checks available local disk space (requiring at least 1.5x the file size). If space is insufficient, the upload is aborted gracefully to prevent disk exhaustion crashes, and the job is NOT retried (structural failure).
7. **Atomic CAS Promotion**: Promoting a processed file to the global `cas/` S3 prefix uses a distributed Redis lock (`lock:cas:{cas_id}`). This prevents concurrent worker processes handling the exact same file from racing to upload to the same S3 key. If the lock holder crashes, waiters will gracefully fail open and skip global CAS promotion, and importantly, will *not* write a false CAS hit to Redis, preventing split-brain S3 key pollution.

## Upload Flow Security Audit Fixes (Audit v3)

### CRITICAL: CAS Pre-Check Exception Handling (`direct.py`)

The CAS deduplication fast-path in the direct upload router previously had a bare `except Exception` handler that caught **all** exceptions — including security rejections like `BadRequestError` (malware detected), `ServiceUnavailableError` (scanner unavailable), and `SvgSecurityError`. This meant a malicious file that triggered a scan failure during the CAS pre-check would be silently allowed through.

**Fix:** Security-critical exceptions (`BadRequestError`, `ServiceUnavailableError`, `SvgSecurityError`) are now explicitly re-raised before the generic fallback catches non-security errors (e.g. Redis timeouts, S3 connectivity):

```python
except (BadRequestError, ServiceUnavailableError, SvgSecurityError):
    raise  # Security rejections must NOT be swallowed
except Exception as _cas_exc:
    logger.debug("CAS pre-check failed, proceeding normally: %s", _cas_exc)
```

### HIGH: Batch Status IDOR via Substring Ownership (`status.py`)

The `batch_upload_status` endpoint previously checked file key ownership using Python's `in` operator (`user_id_str in fk_str`), which is a substring match. This allowed User A (ID `abc`) to query files belonging to User B (ID `xyzabcdef`) because `abc` appears as a substring of `xyzabcdef`.

**Fix:** Ownership is now enforced via strict prefix matching with the user ID followed by a `/` delimiter:

```python
fk_str.startswith(f"quarantine/{user_id_str}/")
or fk_str.startswith(f"uploads/{user_id_str}/")
```

### HIGH: SVG Detection False Positives (`mimetypes.py`)

The `guess_mime_from_bytes` function detected SVG files by searching for `<svg` anywhere in the file content. A plain text file discussing SVG elements (e.g. an HTML tutorial) would be misidentified as `image/svg+xml`, potentially triggering SVG-specific processing on non-SVG content.

**Fix:** SVG detection now only matches when `<svg` appears at or near the start of the document (first 500 bytes, after stripping leading whitespace). Real SVGs always start with `<svg` or `<?xml ... <svg`.

### HIGH: SSE Concurrency Counter Lifetime (`sse.py`)

The SSE concurrency guard was previously applied at the endpoint level via `async with sse_concurrency_guard(...)`. Because FastAPI endpoints return immediately after constructing the `EventSourceResponse` (the generator runs later), the context manager's `finally` block would decrement the counter **before streaming started**, rendering the concurrency limit ineffective.

**Fix:** A two-phase approach:
1. **Eager check at endpoint level:** `redis.incr` + limit check for immediate 429 rejection (no generator needed).
2. **Decrement inside the generator's `finally` block:** The counter stays alive for the actual stream duration and is decremented only when the SSE connection closes.

### MEDIUM: CAS Key Exposure in `check-exists` (`status.py`)

The `check_file_exists` endpoint's global CAS fallback returned the raw `cas/` internal storage key to clients. This leaked internal storage paths and could enable cross-user file probing.

**Fix:** CAS fallback hits now return `exists=True` with `file_key=None`. The upload flow's CAS-hit path handles the actual copy from the global CAS prefix to the per-user prefix.

### MEDIUM: Multipart Abort Silent Error Swallowing (`presigned.py`)

The `presigned_multipart_abort` endpoint had a bare `pass` in the `except` block for DB update failures when marking an upload as cancelled. Errors were silently swallowed with no trace in logs.

**Fix:** Replaced with `logger.warning(...)` to ensure DB failures are recorded for debugging.

### MEDIUM: `AsyncIteratorAdapter` Protocol Violation (`sse.py`)

The `AsyncIteratorAdapter` class had `__aiter__` defined as `async def`, violating the Python async iterator protocol (PEP 492). While this happened to work in CPython due to implementation details, it is not guaranteed by the specification and could break under different runtimes or frameworks.

**Fix:** `__aiter__` is now a regular `def` returning `self`, with a proper `__anext__` async method.

### LOW: `application/octet-stream` Size Limit Bypass (`validators.py`)

Files with MIME type `application/octet-stream` (unknown type) were not matched by any per-category size limit entry, effectively bypassing all size restrictions. The global `max_file_size_mb` fallback is now applied as the ceiling for unmatched MIME types.