# Environment Variables

All configuration is done through environment variables, defined in the `.env` file at the project root. Copy `.env.example` to `.env` as a starting point.

**Key files**: `.env.example`, `api/app/config.py` (Pydantic Settings model)

---

## Configuration Loading

The API uses Pydantic Settings (`api/app/config.py`):

```python
class Settings(BaseSettings):
    model_config = {"env_file": ".env", "extra": "ignore"}
```

- Variables are loaded from environment first, then from `.env` as fallback
- Unknown variables in `.env` are ignored (`extra = "ignore"`)
- All settings have defaults for local development
- The `settings` singleton is imported throughout the codebase: `from app.config import settings`

---

## Variable Reference

### General

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `change-this-to-a-secure-random-string-with-at-least-32-bytes` | JWT signing key. Generate with `openssl rand -hex 32` |
| `ENVIRONMENT` | `development` | `development` or `production`. Controls debug features, rate limiting, SQL logging |

### PostgreSQL

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `wikint` | Database user (used by the postgres container) |
| `POSTGRES_PASSWORD` | `wikint_dev_password` | Database password (used by the postgres container) |
| `POSTGRES_DB` | `wikint` | Database name (used by the postgres container) |
| `POSTGRES_HOST` | `postgres` | Database host (informational, not used by API) |
| `POSTGRES_PORT` | `5432` | Database port (informational, not used by API) |
| `DATABASE_URL` | `postgresql+asyncpg://wikint:wikint_dev_password@postgres:5432/wikint` | Full connection string used by SQLAlchemy |

The `POSTGRES_*` variables configure the PostgreSQL container itself. The API only reads `DATABASE_URL`.

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection string. Used for ARQ, rate limiting, token blacklist, SSE |

### MinIO (S3 Storage)

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ROOT_USER` | `minioadmin` | MinIO admin username |
| `MINIO_ROOT_PASSWORD` | `minioadmin` | MinIO admin password |
| `MINIO_ENDPOINT` | `minio:9000` | Internal S3 API endpoint (container-to-container) |
| `MINIO_PUBLIC_ENDPOINT` | `null` | Public-facing endpoint for presigned URLs. Set when MinIO is behind a proxy |
| `MINIO_BUCKET` | `wikint` | S3 bucket name |
| `MINIO_USE_SSL` | `false` | Use HTTPS for **internal** S3 connections (keep false if using Docker network) |

### Meilisearch

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILI_MASTER_KEY` | `change-me-to-a-random-key` | Master API key. Generate with `openssl rand -hex 16` |
| `MEILI_URL` | `http://meilisearch:7700` | Internal Meilisearch endpoint |

### ClamAV

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAMAV_HOST` | `clamav` | ClamAV daemon hostname |
| `CLAMAV_PORT` | `3310` | ClamAV daemon TCP port |
| `CLAMAV_SCAN_TIMEOUT_BASE` | `60` | Base scan timeout in seconds |
| `CLAMAV_SCAN_TIMEOUT_PER_GB` | `120` | Additional seconds per GB of file size |

### SMTP (Email)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | `smtp.example.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | (empty) | SMTP authentication username |
| `SMTP_PASSWORD` | (empty) | SMTP authentication password |
| `SMTP_FROM` | (empty) | Sender email address |
| `SMTP_USE_TLS` | `true` | Enable STARTTLS |

### JWT

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_ACCESS_TOKEN_EXPIRE_DAYS` | `7` | Access token validity period |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `31` | Refresh token validity period |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS origin and email links |
| `NEXT_PUBLIC_API_URL` | `/api` | API base URL used by the Next.js frontend. In development, defaults to `/api` to route through Nginx. |
| `API_INTERNAL_URL` | `http://api:8000` | Internal API URL used by the Next.js dev server for server-side requests and rewrites. |

### Nginx

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `localhost` | Server domain name (informational) |

---

## Environment-Dependent Behavior

| Feature | `development` | `production` |
|---------|--------------|-------------|
| Swagger UI at `/api/docs` | Enabled | Disabled |
| OpenAPI spec at `/api/openapi.json` | Enabled | Disabled |
| SQLAdmin at `/admin` | Enabled | Disabled |
| SQL query logging | Enabled | Disabled |
| Rate limiting (60/min) | Disabled | Enabled |

These are controlled by the `is_dev` property on the Settings class:

```python
@property
def is_dev(self) -> bool:
    return self.environment == "development"
```

---

## Security Notes

- **Never commit `.env` to version control**. It is listed in `.gitignore`.
- Generate `SECRET_KEY` and `MEILI_MASTER_KEY` with `openssl rand -hex 32`
- Use strong, unique passwords for `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` in production
- `MINIO_PUBLIC_ENDPOINT` must be set correctly if MinIO is behind a proxy, otherwise presigned URLs will point to the internal hostname
