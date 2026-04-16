# System Architecture Overview

## Service Topology

WikINT consists of 7 interconnected services, orchestrated via Docker Compose:

### 1. Nginx Reverse Proxy (`infra/nginx/`)
- Entry point for all traffic
- Routes `/api/*` to the FastAPI backend, `/` to the Next.js frontend, `/onlyoffice/*` to OnlyOffice
- Handles TLS termination in production
- Serves as a static buffer for large upload payloads before they hit the API

### 2. FastAPI API Server (`api/`)
The Python backend is the central nervous system. It runs as a single FastAPI process with:
- **18 route modules** mounted on the app (auth, browse, upload, pull_requests, materials, directories, comments, annotations, flags, notifications, search, users, admin, onlyoffice, tus, pr_comments, tags)
- **CORS middleware** restricted to the configured frontend URL
- **Rate limiting** via slowapi (backed by Redis), disabled in dev mode
- **Request logging middleware** that records method, path, status code, and latency
- **Exception handlers** for `AppError` hierarchy and `RateLimitExceeded`
- **Prometheus /metrics** endpoint (optionally token-protected)
- **SQLAdmin** panel mounted in dev mode only

### 3. ARQ Background Workers
Run the same `api/` codebase but execute as ARQ worker processes. They pull jobs from Redis queues:
- **`upload-fast`** queue: Files under 5 MiB (documents, small images)
- **`upload-slow`** queue: Files at or above 5 MiB (videos, large PDFs)
- **Default queue**: Cleanup tasks, webhook dispatch, search indexing

Worker jobs include:
- `process_upload` - The 4-stage upload pipeline (scan, strip, compress, finalize)
- `cleanup_orphans` - Removes S3 objects with no DB reference
- `cleanup_uploads` - Expires uploads older than 24h
- `reconcile_multipart` - Aborts abandoned S3 multipart uploads
- `dispatch_webhook` - Sends HMAC-signed webhook notifications
- `index_material` / `index_directory` / `delete_indexed_item` - MeiliSearch sync
- `reset_daily_views` - Daily reset of `views_today` counters on all materials (runs at 00:00 UTC)

### 4. PostgreSQL
Primary data store. The schema consists of ~15 tables covering:
- User accounts and roles
- Directory tree (self-referential hierarchy)
- Materials and their versions (with file metadata, view counters)
- Pull requests and comments
- Tags (many-to-many)
- Flags, notifications, annotations, comments, download audits, view history

The connection pool is configured at 20 connections + 10 overflow via asyncpg.

### 5. Redis
Multi-purpose data store:
- **ARQ job queues** (fast/slow upload queues + default)
- **Rate limiting** storage (slowapi)
- **Auth token blacklist** (TTL-based, keyed by JTI)
- **Upload quota tracking** (sorted sets per user, scored by timestamp)
- **Upload status cache** (JSON blobs with TTL for SSE polling)
- **CAS deduplication** (HMAC-keyed SHA-256 -> processed file_key mapping)
- **Pub/Sub channels** for real-time upload progress SSE events
- **Verification code storage** (OTP codes, magic link tokens)
- **Idempotency keys** for upload deduplication
- **View counters** (Real-time `total_views` and `views_today` hot-path tracking)

### 6. MinIO / S3
Object storage with a single bucket organized by key prefix:
- `quarantine/{user_id}/{upload_id}/{filename}` - Unscanned uploads (never served to users)
- `uploads/{user_id}/{upload_id}/{filename}` - Processed, clean files (staging area)
- `materials/{user_id}/{upload_id}/{filename}` - Files attached to approved materials

The storage layer supports both MinIO (development) and Cloudflare R2 (production), with automatic presigned URL host rewriting for custom domains.

### 7. MeiliSearch
Full-text search engine indexing materials and directories. Setup is "soft-fail": if MeiliSearch is unavailable at startup, the API runs in degraded mode (search endpoints return empty results) rather than crashing.

**Two clients are maintained:**
- `meili_admin_client` — uses `MEILI_MASTER_KEY`. Used by `setup_meilisearch`, index workers, and the reindex script. Never exposed to the public search route.
- `meili_search_client` — uses `MEILI_SEARCH_KEY` (a search-only key provisioned via the Meilisearch admin API). Used exclusively by `perform_search`. Falls back to the master key in development if `MEILI_SEARCH_KEY` is unset (logs a warning in production).

**Settings idempotency:** `setup_meilisearch` fetches current index settings on startup and calls `update_settings` only when something has changed, avoiding unnecessary full re-indexes on every app restart.

**Ranking:** Uses Meilisearch-native ranking rules (`like_count:desc`, `total_views:desc` appended after standard rules) so pagination is stable and no client-side re-sorting is needed.

### 8. OnlyOffice Document Server (Optional)
Provides in-browser viewing and editing of Office documents. Integration uses:
- JWT-signed document tokens (separate secret from the API JWT)
- File-access tokens (a third secret, known only to the API) to prevent a compromised OnlyOffice container from forging download URLs

## Application Lifecycle (`main.py`)

The FastAPI app uses the async `lifespan` context manager:

**Startup sequence:**
1. Wait for PostgreSQL to be ready for queries (via `wait_for_db.py` in `start.sh`)
2. Initialize OpenTelemetry instrumentation
3. Setup MeiliSearch indexes (soft-fail)
3. Initialize ARQ Redis pool (soft-fail)
4. Initialize S3 client (hard-fail - required)
5. Initialize MalwareScanner with YARA rules (hard-fail - required)

**Shutdown sequence:**
1. Close MalwareScanner (HTTP client)
2. Close legacy scanner
3. Close ARQ pool
4. Close S3 client
5. Close Redis client

The distinction between soft-fail and hard-fail services is intentional: the API can operate without search or background jobs (degraded), but cannot safely operate without storage or malware scanning.

## Request Flow

```
Browser → Nginx → FastAPI Router → Dependency Injection → Service Layer → Database/Storage
                                          │
                                          ├── CurrentUser (JWT auth)
                                          ├── AsyncSession (DB)
                                          ├── Redis (cache/rate-limit)
                                          └── MalwareScanner (upload routes only)
```

FastAPI's dependency injection is used extensively:
- `CurrentUser` / `OnboardedUser` - JWT extraction + DB user lookup + blacklist check
- `get_db()` - Async session with auto-commit/rollback + post-commit job dispatch
- `get_redis()` - Async Redis client
- `ScannerDep` - Malware scanner from app state
- `rate_limit_uploads` - Per-user upload rate limiting

## Post-Commit Job Pattern

A distinctive pattern in this codebase: database sessions accumulate "post-commit jobs" during a request. After the transaction commits successfully, these jobs are enqueued to ARQ for background execution. This ensures:
1. Jobs only run if the transaction commits (no orphaned background work)
2. The response returns immediately (no blocking on search indexing, S3 cleanup)
3. If the commit fails, no background work is dispatched

```python
# During request handling:
db.info.setdefault("post_commit_jobs", []).append(("index_material", mat_id))
db.info.setdefault("post_commit_jobs", []).append(("delete_storage_objects", [old_key]))

# After commit (in get_db()):
for job in jobs:
    await arq_pool.enqueue_job(*job)
```

This pattern is used throughout the PR approval flow to index new materials and clean up staging files after the transaction lands.
