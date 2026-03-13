# Caching and Queues (Redis)

Redis 7 serves four distinct roles in WikINT: background job queue (ARQ), rate limiting (SlowAPI), JWT token blacklist, and SSE notification dispatch. All roles share a single Redis instance on database 0.

**Key files**: `docker-compose.yml` (redis service), `infra/docker/redis/redis.conf`, `api/app/core/redis.py`, `api/app/main.py` (rate limiter)

---

## Docker Configuration

```yaml
redis:
  image: redis:7-alpine
  command: redis-server /usr/local/etc/redis/redis.conf
  volumes:
    - redis_data:/data
    - ./infra/docker/redis/redis.conf:/usr/local/etc/redis/redis.conf
  ports:
    - "6379:6379"
```

### redis.conf Settings

| Setting | Value | Purpose |
|---------|-------|---------|
| `bind` | `0.0.0.0` | Listen on all interfaces |
| `protected-mode` | `no` | No auth required (internal network only) |
| `port` | `6379` | Standard Redis port |
| `tcp-keepalive` | `300` | Keep connections alive |
| `databases` | `16` | Number of logical databases |
| `maxmemory` | `256mb` | Memory cap |
| `maxmemory-policy` | `allkeys-lru` | Evict least-recently-used keys when full |

### Persistence (RDB Snapshots)

```
save 900 1       # Snapshot if 1+ key changed in 15 min
save 300 10      # Snapshot if 10+ keys changed in 5 min
save 60 10000    # Snapshot if 10000+ keys changed in 1 min
```

Snapshots are written to `/data/dump.rdb` inside the `redis_data` volume.

---

## Redis Client

`api/app/core/redis.py` initializes two Redis connections:

```python
# General-purpose async Redis client
redis_client = Redis.from_url(settings.redis_url, decode_responses=True)

# ARQ connection pool for job dispatch
arq_pool: ArqRedis | None = None
```

The `redis_client` is a singleton created at import time. The `arq_pool` is initialized during FastAPI lifespan startup (`init_arq_pool()`) and closed on shutdown (`close_arq_pool()`).

The `get_redis()` dependency yields the singleton client for use in route handlers.

---

## Role 1: Background Job Queue (ARQ)

ARQ uses Redis as its message broker. See [background-workers.md](./background-workers.md) for full details.

Jobs are dispatched via the post-commit pattern in `get_db()`:

```python
# During request handling, services append jobs:
session.info["post_commit_jobs"].append(("index_material", material.id))

# After commit succeeds, get_db() dispatches:
await redis_core.arq_pool.enqueue_job(*job)
```

---

## Role 2: Rate Limiting (SlowAPI)

`api/app/main.py` configures SlowAPI with Redis as its storage backend:

```python
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.redis_url,
    default_limits=["60/minute"],
    enabled=not settings.is_dev,
)
```

- **Default limit**: 60 requests per minute per IP
- **Disabled in development** (`settings.is_dev`)
- Returns HTTP 429 with `{"detail": "Too many requests"}` when exceeded
- Per-route overrides can be applied with `@limiter.limit()` decorators

---

## Role 3: JWT Token Blacklist

When a user logs out, their refresh token is added to a Redis set with a TTL matching the token's remaining validity. On each authenticated request, the auth dependency checks whether the token is blacklisted.

This is handled in the auth router and auth dependencies (see `api/app/routers/auth.py` and `api/app/dependencies/auth.py`).

---

## Role 4: SSE Notification Queues

The notification system uses Redis lists as per-user message queues for Server-Sent Events:

1. When a notification is created, it's pushed to a Redis list keyed by user ID
2. The SSE endpoint long-polls this list with `BLPOP`
3. Messages are consumed (removed) on read

This enables SSE connections to receive notifications in near real-time without polling the database.

---

## Memory Management

With `maxmemory` set to 256MB and `allkeys-lru` eviction:

- ARQ job data, rate limit counters, and SSE messages compete for the same memory pool
- When memory is full, the least-recently-used keys are evicted first
- Token blacklist entries have explicit TTLs and expire naturally
- ARQ job results are kept for a limited time (ARQ default: 500 seconds)

For production deployments with heavy usage, consider increasing `maxmemory` or separating concerns across multiple Redis databases/instances.
