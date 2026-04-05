# Redis Module (`api/app/core/redis.py`)

## Purpose

Manages Redis connections and the ARQ task queue pool. Redis serves as the backbone for real-time features (SSE, pub/sub), caching (upload status, scan results, CAS entries), rate limiting, authentication state (token blacklist, OTP codes), and background job orchestration.

## Clients

### `redis_client`
A persistent `redis.asyncio.Redis` instance used throughout the application for:
- Upload status caching (`upload:status:{key}`)
- CAS deduplication entries (`upload:cas:{hmac}`)
- Scan result caching (`upload:scanned:{key}`)
- SHA-256 lookup caching (`upload:sha256:{user_id}:{hash}`)
- Upload quota tracking (`quota:uploads:{user_id}` - sorted sets)
- Auth verification codes and magic tokens
- Token blacklist (`blacklist:{jti}` with TTL)
- Pub/Sub for SSE event channels (`upload:events:{key}`)
- Upload idempotency keys (`upload:idem:{key}`)

### `arq_pool`
An ARQ `ArqRedis` pool used exclusively for enqueueing background jobs. Initialized during app startup via `init_arq_pool()`.

### `get_redis()`
FastAPI dependency that yields the `redis_client`. Used in route handlers for cache reads/writes.

## Key Namespaces

| Prefix | Type | TTL | Purpose |
|--------|------|-----|---------|
| `upload:status:{key}` | String (JSON) | 1h | Upload pipeline progress for SSE |
| `upload:events:{key}` | Pub/Sub channel | - | Real-time progress events |
| `upload:eventlog:{key}` | List | 2h | Event replay for late-connecting SSE clients |
| `upload:cas:{hmac}` | String (JSON) | none | CAS deduplication (permanent until ref_count drops to 0) |
| `upload:scanned:{key}` | String | 24h | Scan result cache ("CLEAN") |
| `upload:sha256:{uid}:{hash}` | String | 24h | Per-user SHA-256 to file_key lookup |
| `upload:idem:{key}` | String | 25h | Idempotency key for duplicate upload detection |
| `upload:intent:{key}` | String | 1h | Presigned upload intent validation |
| `quota:uploads:{uid}` | Sorted Set | - | Active uploads per user (scored by timestamp) |
| `blacklist:{jti}` | String | remaining TTL | Revoked JWT token IDs |
| `verify:{email}` | String | 10min | OTP verification codes |
| `verify:rate:{email}` | Counter | 10min | OTP request rate limiting |
| `magic:{token}` | String | 15min | Magic link tokens |

## ARQ Queue Architecture

Three queues with different processing characteristics:

| Queue | Jobs | Rationale |
|-------|------|-----------|
| `upload-fast` | Files < 5 MiB | Small documents/images complete in seconds |
| `upload-slow` | Files >= 5 MiB | Large videos/PDFs may take minutes to process |
| (default) | Cleanup, indexing, webhooks | Lightweight operations |

This separation prevents a 500 MiB video transcoding job from blocking a 100 KB PDF upload behind it in a single-threaded worker.

## Lua Scripts

The process_upload worker uses atomic Lua scripts for CAS reference counting:

**`_LUA_CAS_INCR`:** Atomically increments `ref_count` in a CAS JSON entry. Used when a duplicate file is detected and a copy is made instead of re-processing.

**`_LUA_CAS_DECR`:** Atomically decrements `ref_count` and deletes the entry when it reaches 0. Used during file cleanup to determine if the underlying S3 object can be safely deleted.

These scripts run atomically on Redis, preventing race conditions between concurrent uploads of the same file.
