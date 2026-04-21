# Storage Module (`api/app/core/storage.py`)

## Purpose

Provides the entire S3-compatible object storage abstraction. Every file operation in the system (upload, download, copy, move, delete, presigned URLs) flows through this module. It abstracts the differences between MinIO (development) and Cloudflare R2 (production) behind a unified async API.

## Client Lifecycle

The module maintains a **persistent S3 client** (`_s3`) initialized during app startup:

```python
_session = aioboto3.Session()
_s3: Any = None  # Set by init_s3_client()
```

- `init_s3_client()` - Called during FastAPI lifespan startup. Creates and enters the async context manager for the aioboto3 client. **Hard-fail**: if this fails, the app cannot start.
- `close_s3_client()` - Called during shutdown. Exits the context manager.
- `get_s3_client()` - Context manager that yields the persistent client if available, or creates a fresh one-shot client. This fallback ensures code outside the request lifecycle (e.g., test fixtures) can still access storage.

**Configuration:** SigV4 signing is forced for all requests (required by both R2 and modern MinIO). 

### S3 Transfer Acceleration
Added backend support for S3 Transfer Acceleration, which can be enabled via `S3_USE_ACCELERATE_ENDPOINT=true`. 
- **Note for R2/MinIO:** Keep this `false`. R2 is globally accelerated by default via Cloudflare Anycast, and MinIO does not support this AWS-specific API.

## S3 Lifecycle Policies

To ensure the storage remains efficient and free of orphaned or abandoned files, the following lifecycle rules are enforced on the Cloudflare R2 bucket. These offload cleanup tasks to the cloud provider, reducing compute overhead on WikINT workers.

### 1. Expire Quarantine Objects
*   **Prefix:** `quarantine/`
*   **Expiration:** 1 day (24 hours) after creation.
*   **Rationale:** The `quarantine/` folder is a temporary landing zone for scanning. If a file persists for 24 hours, the upload was either abandoned or the worker job failed.

### 2. Expire Legacy Staged Uploads (V1 — can be removed post-migration)
*   **Prefix:** `uploads/`
*   **Expiration:** 7 days after creation.
*   **Rationale:** Legacy V1 staging area. New uploads go directly to `cas/`. This rule cleans up any remaining V1 objects.

### 3. Abort Incomplete Multipart Uploads
*   **Action:** Abort incomplete multipart uploads.
*   **Expiration:** 7 days after initiation.
*   **Rationale:** Large file uploads (S3 Multipart) can be interrupted. This rule ensures partial chunks do not consume storage space indefinitely.

### 4. Permanent Prefix (NO Lifecycle Rules)
*   **Prefix:** `cas/`
*   **Policy:** This prefix MUST NOT have automated expiration rules. CAS contains the single source of truth for all file content, managed via server-side reference counting.

## Key Operations

### Upload Paths

**Single put (`upload_file`):** For files under 5 MiB. Sends the entire file in one `upload_file` call (which is natively optimized by aioboto3 to use async threadpools for file paths, completely offloading synchronous disk reads) with configurable `ContentType`, `ContentEncoding`, and `ContentDisposition`. The default `ContentDisposition: attachment` is a security measure — it forces browsers to download rather than render uploaded content inline (preventing XSS via uploaded HTML/SVG).

**Multipart upload (`upload_file_multipart`):** For files >= 5 MiB. Follows the standard S3 multipart protocol:
1. `create_multipart_upload()` - Initiates the upload, returns an UploadId
2. `upload_part()` / `upload_part_stream()` - Uploads individual parts (8 MiB chunks by default)
3. `complete_multipart_upload()` - Assembles the parts into the final object
4. `abort_multipart_upload()` - Cleans up on failure (best-effort, swallows exceptions)

The `upload_file_multipart` function automatically selects single-put vs multipart based on file size, reads the file in chunks via `asyncio.to_thread` to avoid blocking the event loop, and properly aborts the multipart upload if any part fails.

> **Note:** `create_multipart_upload` does not currently propagate `content_encoding` to the S3 `CreateMultipartUpload` call. In practice this is benign because all gzip-compressed files (text/*, SVG) are well below the 5 MiB multipart threshold after compression and always go through the single `upload_file` path where `ContentEncoding` is set correctly.

### Presigned URLs

**`generate_presigned_put()`:** Creates a time-limited URL for direct browser-to-S3 uploads. Used by the presigned upload flow where the client uploads directly to MinIO/R2, bypassing the API server for the data transfer.

**`generate_presigned_get()`:** Creates a download URL. Contains a critical security check:

```python
if file_key.startswith("quarantine/"):
    raise ValueError("Refusing to generate presigned GET for unscanned quarantine key")
```

This hard-coded check prevents any code path from accidentally serving unscanned files to users, even if the business logic has a bug.

The `force_download` parameter controls whether the URL includes `ResponseContentDisposition: attachment`. It defaults to `True` (download) but is set to `False` for OnlyOffice integration where inline viewing is required.

### Host Rewriting (`_rewrite_host`)

Presigned URLs generated against MinIO point to the internal Docker hostname (`minio:9000`). In development, these must be rewritten to the public-facing proxy (`localhost/s3`) so the browser can reach them.

- **Auto-Warming Logic**: The storage module now automatically loads S3 settings from the database (via `get_full_auth_config`) and warms the Redis cache if it's missing. This ensures that the correct public endpoint is always used, even if the cache hasn't been pre-populated.
- **In Development**: If the public endpoint contains "localhost", the host is rewritten and the scheme is forced to `http`.
- **In Production (Cloudflare R2)**:
  - **GET URLs**: Rewrites host and strips the bucket name from the path (R2 custom domains map directly to the bucket root).
  - **PUT URLs**: Does NOT rewrite to custom domain, as R2 custom domains do not support presigned PUT. They go to the R2 endpoint directly.

### Object Management

- `move_object()` - Copy + delete (no native S3 move)
- `copy_object()` - Used for legacy V1 migration (materials/ to cas/) and edge cases
- `delete_object()` - Deletes the S3 object AND cleans up the Redis quota sorted set entry.
- `cas_object_exists(sha256)` - Check if a file already exists in the `cas/` prefix.
- `object_exists()` - HEAD request, returns boolean
- `get_object_info()` - Returns `{size, content_type}` from HEAD response
- `read_full_object()` - Reads entire object into memory (use sparingly)
- `read_object_bytes()` - Reads first N bytes (default: `MAGIC_HEADER_SIZE` = 8192) for MIME detection
- `stream_object()` - Async context manager yielding the response body for chunked reading
- `update_object_content_type()` - Copy-to-self with `MetadataDirective: REPLACE` to change content type

### Multipart Management

- `list_multipart_uploads()` - Paginated listing of in-progress multipart uploads (used by the reconciliation worker)
- `generate_presigned_upload_part()` - Presigned URL for a single part of a multipart upload (client-side multipart)

## Bucket Key Schema (CAS V2)

```
wikint/
├── quarantine/{user_id}/{upload_id}/{filename}    # Unscanned, never served (TTL 24h)
└── cas/{hmac_sha256}                              # Single source of truth (Permanent)
```

**Retired prefixes** (V1 legacy, cleaned up by the migration and cleanup worker):
- `uploads/` — Processed staging copies (replaced by direct CAS references)
- `materials/` — Published copies (replaced by direct CAS references)

File progression through the pipeline:

1. File uploaded to `quarantine/` (or directly via presigned URL)
2. Worker processes and writes directly to `cas/` (single upload, no copy)
3. `Upload.final_key` = `cas/{hmac}` (no intermediate staging object)
4. PR approved: `MaterialVersion.file_key` = `cas/{hmac}` (no copy needed)
5. Downloads reconstruct filenames via `ResponseContentDisposition` from DB metadata

### CAS Reference Counting

Each `cas/` object is protected by an atomic Redis ref count (`upload:cas:{hmac}`):

| Event | Action |
|-------|--------|
| Upload finalize | `increment_cas_ref` (staging window); S3 object always overwritten with freshly-processed file |
| PR approval (MaterialVersion created) | `increment_cas_ref` (publication) |
| Upload expires/cancelled | `decrement_cas_ref` |
| MaterialVersion deleted | `decrement_cas_ref` |
| ref_count reaches 0 | S3 object + Redis key deleted |

## Dependencies

- `aioboto3` - Async boto3 wrapper
- `botocore` - AWS SDK configuration (SigV4)
- `app.config.settings` - All S3 connection parameters
- `app.core.constants.MAGIC_HEADER_SIZE` - Byte count for MIME detection reads
- `app.core.redis.redis_client` - For quota sorted set cleanup on delete

## Performance Notes

### `download_file_with_hash` — Single-Pass Download + SHA-256

Downloads an S3 object and computes its SHA-256 hash in one streaming pass. Each chunk is written to disk and fed to the hasher in a single `asyncio.to_thread` call, ensuring the hash update runs off the event loop alongside the disk I/O rather than as a separate blocking operation.
