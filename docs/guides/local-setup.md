# Local Development Setup

This guide covers getting WikINT running on a local machine for development.

---

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- **Git**
- No other runtime dependencies -- everything runs in containers

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd WikINT

# 2. Create environment file
cp .env.example .env

# Note: For local development, ensure .env has:
# MINIO_PUBLIC_ENDPOINT=localhost:9000
# This allows the browser to reach MinIO for file uploads/downloads.
#
# NEXT_PUBLIC_API_URL is set automatically to http://localhost/api by
# docker-compose.dev.yml (routing browser API calls through nginx on port 80).
# SSE (real-time annotations / notifications) requires this nginx routing.
# If running Next.js outside Docker, set NEXT_PUBLIC_API_URL=http://localhost:8000/api.

# 3. Start the development stack
./run.sh --dev
```

This starts all 10 services with hot-reloading enabled. First run will take several minutes to build images and download dependencies.

---

## Service Access Points

Once running, these services are available:

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | http://localhost:3000 | Next.js with HMR |
| API | http://localhost:8000 | FastAPI with auto-reload |
| API Docs (Swagger) | http://localhost:8000/api/docs | Interactive API explorer |
| API Docs (OpenAPI) | http://localhost:8000/api/openapi.json | Raw OpenAPI spec |
| SQLAdmin | http://localhost:8000/admin | Database browser |
| MinIO Console | http://localhost:9001 | File storage browser |
| Meilisearch | http://localhost:7700 | Search engine dashboard |
| Nginx | http://localhost:80 | Reverse proxy (optional in dev) |

---

## Initial Data

After the stack is running, seed the database with an admin user and the default directory structure:

```bash
docker compose exec api uv run python -m app.cli seed --email "your@email.com"
```

This creates:
- A user with `bureau` role (admin access)
- The default directory tree: `1A/(S1, S2)`, `2A/(S1, S2)`, `3A/(S1, S2)`

To create a regular student account:

```bash
docker compose exec api uv run python -m app.cli seed --email "student@email.com" --role student
```

---

## Authentication in Development

WikINT uses passwordless email authentication. In development, you have two options:

1. **Configure a real SMTP server**: Set `SMTP_*` variables in `.env` to use an actual mail service
2. **Check API logs**: The verification code is logged to the API container output. Watch with:

```bash
docker compose logs -f api
```

---

## Hot Reloading

The development compose overlay (`docker-compose.dev.yml`) bind-mounts source directories:

| Service | Mount | Effect |
|---------|-------|--------|
| `api` | `./api:/app`<br>`/app/.venv` | Uvicorn `--reload` watches for Python file changes. The `.venv` anonymous volume prevents local environment conflicts. |
| `worker` | `./api:/app`<br>`/app/.venv` | Worker restarts on code changes. The `.venv` volume isolates the container's virtual environment. |
| `web` | `./web:/app`<br>`/app/node_modules` | Next.js HMR via `pnpm dev`. The `node_modules` volume prevents local dependencies from shadowing the container's. |

Changes to source files are reflected immediately without rebuilding containers.

---

## Rebuilding

When you change dependencies (add packages to `pyproject.toml` or `package.json`):

```bash
# Rebuild all images
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Or rebuild a specific service
docker compose -f docker-compose.yml -f docker-compose.dev.yml build api
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

## Useful Commands

```bash
# View logs for a specific service
docker compose logs -f api
docker compose logs -f web

# Open a shell in the API container
docker compose exec api bash

# Open a PostgreSQL shell
docker compose exec postgres psql -U wikint -d wikint

# Open a Redis shell
docker compose exec redis redis-cli

# Rebuild search indexes
docker compose exec api uv run python -m app.cli reindex

# Stop everything (keeps data)
docker compose down

# Stop and delete all data
docker compose down -v
```

---

## Docker Security & Resource Configuration

### Network Segmentation

Services are split across two Docker networks for isolation:

| Network | Services |
|---------|----------|
| `frontend` | nginx, web, api |
| `backend` | api, worker, postgres, redis, minio, meilisearch |

The `api` service bridges both networks: it receives proxied requests from nginx on the `frontend` network and communicates with databases and storage on the `backend` network. Nginx also joins both networks so it can proxy to both `api` and `web` on the frontend and reach `minio` on the backend for the `/s3/` location.

### Resource Limits

Each service has CPU and memory limits configured via `deploy.resources.limits` in the compose files. This prevents any single service from consuming all host resources during development.

### Non-Root API Container

The API Dockerfile creates a non-root `appuser` and runs the application under that user. This limits the blast radius of any potential container escape.

### Rate Limiting

Rate limiting is always active, including in development mode. Dev mode uses higher limits to avoid friction during testing:

| Endpoint | Dev Limit |
|----------|-----------|
| Upload requests | 100/min, 1000/day |
| Download requests | 100/min, 2000/day |

Production limits are lower (see the upload and download endpoint documentation).

---

## Troubleshooting

### Port conflicts

If ports are already in use, either stop the conflicting service or modify the port mappings in `docker-compose.dev.yml`. The most commonly conflicted ports are 5432 (PostgreSQL) and 3000 (Node.js).

### "Module not found" errors in the API

The dev overlay runs `uv sync --frozen --no-dev` on startup. If you added new dependencies, rebuild the container or exec into it and run `uv sync` manually.

### Frontend build errors after pulling changes

Clear the Next.js cache:

```bash
docker compose exec web rm -rf .next
docker compose restart web
```

### SSE / CORS errors in browser console

If you see "can't establish connection" for `/api/…/sse` endpoints, the nginx dev proxy
is not serving on port 80.

**In Docker dev** — `docker-compose.dev.yml` exposes nginx on port 80 and sets
`NEXT_PUBLIC_API_URL=http://localhost/api`. SSE connections go through nginx which has
proper streaming config (`proxy_buffering off`, `proxy_cache off`). Recreate the
containers to pick up the setting:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate
```

**Outside Docker** — set `NEXT_PUBLIC_API_URL=http://localhost:8000/api` and ensure the
API is running on port 8000. CORS is configured to allow `http://localhost:3000` so
direct requests work.
