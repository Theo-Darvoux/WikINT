# Database Module (`api/app/core/database.py`)

## Purpose

Provides the async SQLAlchemy engine, session factory, and the `get_db()` dependency that manages transaction lifecycle and post-commit job dispatch.

## Engine Configuration

```python
engine = create_async_engine(
    settings.database_url,
    echo=settings.is_dev,          # SQL logging in development
    pool_size=20,                  # Persistent connections
    max_overflow=10,               # Burst capacity to 30 total
)
```

- Uses `asyncpg` driver (inferred from `postgresql+asyncpg://` DSN)
- SQLite mode is detected for test environments (disables pooling)
- `expire_on_commit=False` on the session factory — this is critical for FastAPI where you often access ORM objects after commit (e.g., returning them in the response)

## The `get_db()` Dependency

This is the most architecturally significant function in the database module. It implements the **post-commit job pattern**:

```python
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        jobs = []
        session.info["post_commit_jobs"] = jobs
        try:
            yield session
            await session.commit()

            # After successful commit: dispatch background jobs
            if jobs:
                for job in jobs:
                    await arq_pool.enqueue_job(*job)
        except Exception:
            await session.rollback()
            raise
```

### Why This Matters

The `session.info["post_commit_jobs"]` list is a thread-local accumulator. Any code that has access to the session can append jobs:

```python
db.info.setdefault("post_commit_jobs", []).append(("index_material", mat_id))
```

These jobs are **only dispatched after the transaction commits successfully**. If the transaction rolls back (exception), the jobs are silently discarded. This solves a class of bugs where:

1. A search index would be updated for a material that was never actually persisted (transaction rolled back)
2. An S3 object would be deleted before the DB reference to it was committed
3. A notification would be sent for a PR that failed to save

### Critical Error Handling

If ARQ pool is unavailable after a successful commit, the system logs a `CRITICAL` error. This is a data consistency issue — the database was mutated but the background work (search indexing, cleanup) will not run. The system does not crash, but the critical log ensures this gets noticed.

### Job Types Dispatched

Jobs enqueued via this pattern include:
- `("index_material", uuid)` - Index/re-index a material in MeiliSearch
- `("index_directory", uuid)` - Index/re-index a directory
- `("delete_indexed_item", "materials", str(uuid))` - Remove from search index
- `("delete_storage_objects", [key1, key2])` - Clean up S3 objects

## Session Factory

`async_session_factory` is also exported directly for use in contexts outside the FastAPI dependency system (background workers, CLI commands). Workers create their own sessions via:

```python
async with async_session_factory() as session:
    # ... direct session usage
```

This bypasses the post-commit job pattern, so workers that need to dispatch further jobs must do so manually.
