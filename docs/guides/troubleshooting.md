# Troubleshooting

Common issues and their solutions when running WikINT.

---

## Startup Issues

### API or Worker fails with "Permission denied" on `.venv`

If you see errors like `failed to remove file /app/.venv/.gitignore: Permission denied (os error 13)`, it means the host environment's `.venv` directory was shadowing the container's environment. 

This issue is mitigated by an anonymous volume in `docker-compose.dev.yml` (`- /app/.venv`), but if it still occurs:
1. Ensure your local `docker-compose.dev.yml` includes the anonymous volume for `/app/.venv` for both `api` and `worker` services.
2. Stop the containers: `docker compose down`
3. Restart and force volume recreation: `./run.sh --dev` (which rebuilds and recreates).

### API fails to connect to PostgreSQL

Ensure the `DATABASE_URL` in `.env` uses the Docker service name as host (`postgres`, not `localhost`):

```
DATABASE_URL=postgresql+asyncpg://wikint:password@postgres:5432/wikint
```

If running outside Docker, use `localhost` or the actual host IP instead.

### MinIO setup fails

Check that the `minio` service is healthy before `minio-setup` runs:

```bash
docker compose ps minio
docker compose logs minio-setup
```

The setup script is idempotent (`mc mb --ignore-existing`), so re-running is safe:

```bash
docker compose restart minio-setup
```

### Worker crashes with "redis.exceptions.ConnectionError"

If the worker logs show `Error -3 connecting to redis:6379. Temporary failure in name resolution`, this is a startup race condition — the worker started before Redis was ready. Both compose files have `depends_on` with healthcheck conditions and `restart: unless-stopped`, so the worker will automatically restart and connect successfully. No manual intervention needed.

If it persists, check that Redis is healthy:

```bash
docker compose ps redis
docker compose logs redis
```

### Meilisearch won't start

If Meilisearch fails with index corruption errors, clear its data:

```bash
docker compose down meilisearch
docker volume rm wikint_meilisearch_data
docker compose up -d meilisearch
docker compose exec api uv run python -m app.cli reindex
```

---

## Runtime Issues

### Search results are stale or missing

Search indexes can get out of sync if the worker was down when changes were made. Rebuild:

```bash
docker compose exec api uv run python -m app.cli reindex
```

### Rate limiting in development

SlowAPI rate limiting is automatically disabled when `ENVIRONMENT=development`. If you're seeing 429 errors in dev, check that your `.env` has:

```
ENVIRONMENT=development
```

### SSE connections drop

Server-Sent Events require long-lived connections. The nginx config sets `proxy_read_timeout 300s` for the API upstream. If SSE drops after 5 minutes, this is expected -- the client auto-reconnects.

If SSE drops sooner, check that `proxy_buffering off` is set in the nginx config for the `/api/` location.

### File uploads fail

1. **413 Request Entity Too Large**: The file exceeds nginx's `client_max_body_size` (must match `MAX_FILE_SIZE_MB` in `.env`, default 100 MiB).
2. **Malware scan fails**: Check that YARA rules are present in `api/yara_rules/` and that MalwareBazaar is reachable (the API needs outbound HTTPS access to `mb-api.abuse.ch`). Check API logs for scanner errors:
   ```bash
   docker compose logs api | grep -i scanner
   ```

### Email not sending

Check SMTP configuration:

```bash
docker compose logs api | grep -i smtp
```

Verify `.env` settings:
- `SMTP_HOST`, `SMTP_PORT` -- correct server and port
- `SMTP_USE_TLS=true` for port 587, or adjust for your provider
- `SMTP_USER` and `SMTP_PASSWORD` -- valid credentials
- `SMTP_FROM` -- must be an authorized, valid email format (e.g., `noreply@your-domain.com` or `"WikINT <noreply@your-domain.com>`). A bare string like `WikINT` will cause a 501 Syntax Error on some SMTP servers.

---

## Reverse Proxy & Networking Issues

### 502 Bad Gateway / Frontend not loading

If your outer reverse proxy is returning a 502 error and `docker compose logs web` shows `sh: next: not found`, ensure your `docker-compose.yml` does **not** override the Next.js standalone startup command. 

Remove `command: npm start` from the `web` service in `docker-compose.yml`. The standalone build defined in the Dockerfile correctly uses `node server.js`.

### MinIO Content-Security-Policy (CSP) Errors / connect-src block

If uploads or avatars fail with a CSP error blocking `http://your-domain.com/s3/...` on an `https://` site:
1. Ensure your `.env` has `MINIO_PUBLIC_ENDPOINT=your-domain.com/s3` (without `http://` or `https://`).
2. Do **not** set `MINIO_USE_SSL=true`. That variable controls *internal* connections between the API and MinIO containers. If you are using the default Docker setup, the internal connection must remain HTTP (`false`).
3. The backend automatically forces `https://` for the generated pre-signed URLs if `MINIO_PUBLIC_ENDPOINT` is not `localhost`.

---

## Data Issues

### User can't log in after soft-delete

Soft-deleted users (those with `deleted_at` set) are excluded from auth queries. If within the 30-day retention window, the user record still exists but is inaccessible. After 30 days, the `gdpr_cleanup` cron permanently removes it.

To restore a soft-deleted user (within 30 days):

```bash
docker compose exec postgres psql -U wikint -d wikint -c \
  "UPDATE users SET deleted_at = NULL WHERE email = 'user@example.com';"
```

### Directory tree is missing

The default directory tree (`1A/S1`, `1A/S2`, `2A/S1`, etc.) is created by the `seed` command. Run it again -- it's idempotent:

```bash
docker compose exec api uv run python -m app.cli seed --email "admin@example.com"
```

### Pull request stuck in "open" state

PRs require a vote threshold to auto-approve. Check the current vote count in the admin panel at `/admin/pull-requests`. A moderator (`member`, `bureau`, or `vieux` role) can manually approve or reject.

---

## Container Management

### Reset everything

```bash
# Stop and remove all containers and volumes
docker compose down -v

# Rebuild from scratch
./run.sh --dev
```

### View resource usage

```bash
docker compose stats
```

### Inspect a container

```bash
docker compose exec <service> sh
```
