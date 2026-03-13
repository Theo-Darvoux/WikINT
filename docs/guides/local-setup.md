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

# 3. Start the development stack
./run.sh --dev
```

This starts all 11 services with hot-reloading enabled. First run will take several minutes to build images and download dependencies.

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
| `api` | `./api:/app` | Uvicorn `--reload` watches for Python file changes |
| `worker` | `./api:/app` | Worker restarts on code changes |
| `web` | `./web:/app` | Next.js HMR via `pnpm dev` |

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

## Troubleshooting

### ClamAV takes a long time to start

ClamAV downloads virus signature databases on first start (~120 seconds). The `start_period: 120s` health check accounts for this. Subsequent starts use cached signatures from the `clamav_data` volume.

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
