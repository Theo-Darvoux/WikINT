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

### S3-Compatible Storage

Supports MinIO (development) and Cloudflare R2 (production).

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_ACCESS_KEY` | `minioadmin` | S3 access key (MinIO admin user or R2 API token key) |
| `S3_SECRET_KEY` | `minioadmin` | S3 secret key (MinIO admin password or R2 API token secret) |
| `S3_ENDPOINT` | `minio:9000` | S3 API endpoint. MinIO: `minio:9000`, R2: `<account-id>.r2.cloudflarestorage.com` |
| `S3_PUBLIC_ENDPOINT` | `null` | Public-facing endpoint for presigned URLs. Dev: `localhost/s3`, R2: `files.yourdomain.com` |
| `S3_BUCKET` | `wikint` | S3 bucket name |
| `S3_REGION` | `us-east-1` | S3 region. MinIO: `us-east-1`, R2: `auto` |
| `S3_USE_SSL` | `false` | Use HTTPS for S3 connections. `false` for Docker-internal MinIO, `true` for R2 |

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

### CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ALLOWED_HEADERS` | `Content-Type,Authorization,X-Client-ID,Accept,X-Requested-With` | Comma-separated list of allowed CORS headers. Shared between FastAPI and Nginx to keep them in sync. |

### ONLYOFFICE Document Server

| Variable | Default | Description |
|----------|---------|-------------|
| `ONLYOFFICE_JWT_SECRET` | `change-me-onlyoffice-jwt-secret` | JWT secret shared between the API and ONLYOFFICE. Must match `JWT_SECRET` on the container. Generate with `openssl rand -hex 32` |
| `ONLYOFFICE_FILE_TOKEN_SECRET` | `change-me-onlyoffice-file-token-secret` | Separate secret for file-access tokens (API-only, NOT shared with OnlyOffice). Must differ from `ONLYOFFICE_JWT_SECRET`. Generate with `openssl rand -hex 32` |
| `NEXT_PUBLIC_ONLYOFFICE_URL` | `http://localhost/onlyoffice` | Browser-facing URL for loading the ONLYOFFICE JS API. In Docker dev, nginx proxies `/onlyoffice/` to the container. |

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
- Use strong, unique passwords for `POSTGRES_PASSWORD` and `S3_SECRET_KEY` in production
- `S3_PUBLIC_ENDPOINT` must be set correctly so presigned URLs point to the public-facing hostname (e.g., R2 custom domain or nginx proxy)
