# Database (PostgreSQL)

WikINT uses PostgreSQL 16 (Alpine) as its primary data store, accessed via SQLAlchemy 2.0 async ORM with the asyncpg driver.

**Key files**: `docker-compose.yml` (postgres service), `infra/docker/postgres/init.sql`, `api/app/core/database.py`, `api/app/config.py`

---

## Docker Configuration

```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: ${POSTGRES_DB}
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./infra/docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
  ports:
    - "5432:5432"
```

The `init.sql` script is minimal -- PostgreSQL 14+ includes `gen_random_uuid()` natively, so no extensions are needed. The database and user are created automatically from environment variables.

---

## Connection Pool

`api/app/core/database.py` configures the async engine:

```python
engine = create_async_engine(
    settings.database_url,
    echo=settings.is_dev,   # Log SQL in development
    pool_size=20,
    max_overflow=10,
)
```

| Parameter | Value | Notes |
|-----------|-------|-------|
| `pool_size` | 20 | Base number of persistent connections |
| `max_overflow` | 10 | Extra connections under load (up to 30 total) |
| `echo` | `True` in dev | Logs all SQL statements |
| Driver | asyncpg | Native PostgreSQL async driver |

The connection string format is: `postgresql+asyncpg://user:password@host:port/dbname`

---

## Session Management

The `get_db()` dependency provides request-scoped sessions with automatic commit/rollback and post-commit job dispatch:

```mermaid
sequenceDiagram
    participant R as Request
    participant S as AsyncSession
    participant Q as ARQ Queue

    R->>S: yield session
    Note over S: Route handler executes,<br/>may append to post_commit_jobs
    S->>S: commit()
    loop For each post_commit_job
        S->>Q: enqueue_job(...)
    end
    Note right of S: On exception: rollback()
```

This pattern ensures background jobs (search indexing, upload processing) are only enqueued after the database transaction succeeds.

---

## Schema Management

WikINT uses **Alembic** for database migrations. The migration scripts are located in `api/app/migrations/versions/`.

### Migration Workflow

To generate a new migration after updating SQLAlchemy models:
```bash
docker exec wikint-api-1 uv run alembic revision --autogenerate -m "description"
```

To apply migrations:
```bash
docker exec wikint-api-1 uv run alembic upgrade head
```

Migrations are automatically run on container startup via `api/start.sh`.

### Tables

| Table | Model | Description |
|-------|-------|-------------|
| `users` | `User` | User accounts with soft delete |
| `directories` | `Directory` | Self-referential tree (folder/module hierarchy) |
| `materials` | `Material` | Uploaded documents and files |
| `material_versions` | `MaterialVersion` | Version history for materials |
| `tags` | `Tag` | Reusable tags with optional category |
| `material_tags` | (junction) | Many-to-many: materials <-> tags |
| `directory_tags` | (junction) | Many-to-many: directories <-> tags |
| `pull_requests` | `PullRequest` | Batch edit proposals (JSONB operations) |
| `pr_votes` | `PRVote` | Votes on pull requests |
| `pr_comments` | `PRComment` | Comments on pull requests |
| `annotations` | `Annotation` | Self-referential threads on materials |
| `comments` | `Comment` | Polymorphic comments (target_type + target_id) |
| `flags` | `Flag` | Polymorphic moderation flags |
| `notifications` | `Notification` | Per-user notification records |
| `view_history` | `ViewHistory` | Recently viewed materials per user |

### Key Design Patterns

- **UUID primary keys**: All tables use `gen_random_uuid()` server defaults
- **Soft deletes**: `User` has a `deleted_at` timestamp; soft-deleted users are excluded from queries
- **JSONB columns**: `PullRequest.operations`, `Directory.metadata_`, `Annotation.position_data`
- **Self-referential trees**: `Directory.parent_id` and `Annotation.parent_id` reference their own tables
- **Polymorphic associations**: `Comment` and `Flag` use `target_type` + `target_id` to reference any entity

---

## SQL Views

Two database views provide aggregate statistics:

| View | Purpose |
|------|---------|
| `user_reputation_view` | Calculates reputation score per user from approved PRs, annotations, comments |
| `user_stats_view` | Counts approved PRs, total annotations, total comments per user |

These are queried via `text()` SQL in the user service layer.

---

## Backup & Data Safety

- Data persists in the `postgres_data` Docker volume
- The volume survives container restarts and image rebuilds
- `docker compose down` preserves volumes; `docker compose down -v` destroys them
- No automated backup is configured -- this should be set up in production (e.g., `pg_dump` cron)
