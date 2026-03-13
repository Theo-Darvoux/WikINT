# Troubleshooting

Common issues and their solutions when running WikINT.

---

## Startup Issues

### ClamAV is slow to start / health check fails

ClamAV downloads virus signature databases on first boot, which takes 1-2 minutes. The Docker health check has `start_period: 120s` to accommodate this. On subsequent starts, signatures are cached in the `clamav_data` volume.

If ClamAV consistently fails to start, check its logs:

```bash
docker compose logs clamav
```

Common causes: network restrictions blocking signature downloads, insufficient disk space.

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

1. **413 Request Entity Too Large**: The file exceeds nginx's `client_max_body_size` (1 GB). This limit also applies to presigned URLs if they pass through nginx.
2. **Presigned URL expired**: URLs are valid for 1 hour (PUT) or 15 minutes (GET). If the upload takes too long, request a new URL.
3. **ClamAV scan fails**: Check ClamAV is running and accessible on port 3310:
   ```bash
   docker compose exec api python -c "import socket; s=socket.socket(); s.connect(('clamav', 3310)); print('OK')"
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
- `SMTP_FROM` -- must be an authorized sender address

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
