# Deployment Guide

This guide covers deploying WikINT to a production server.

---

## Requirements

- A Linux server with Docker and Docker Compose v2+
- A domain name with DNS pointing to the server
- Port 80 and 443 open to the internet
- An SMTP server for email delivery

---

## Steps

### 1. Clone and Configure

```bash
git clone <repository-url>
cd WikINT
cp .env.example .env
```

Edit `.env` with production values. See [Environment Variables](../configuration/environment-variables.md) for the full reference. Critical settings:

```bash
# Generate a strong secret key
SECRET_KEY=$(openssl rand -hex 32)
ENVIRONMENT=production

# Database
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgresql+asyncpg://wikint:<password>@postgres:5432/wikint

# MinIO
MINIO_ROOT_USER=<unique-username>
MINIO_ROOT_PASSWORD=<strong-random-password>
MINIO_PUBLIC_ENDPOINT=<your-domain>:9000  # or behind CDN

# Meilisearch
MEILI_MASTER_KEY=$(openssl rand -hex 16)

# SMTP
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=noreply@your-domain.com
SMTP_PASSWORD=<smtp-password>
SMTP_FROM=noreply@your-domain.com
SMTP_USE_TLS=true

# Frontend
FRONTEND_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com/api

# Domain
DOMAIN=your-domain.com
```

### 2. Start the Stack

```bash
./run.sh --prod
```

This builds all images and starts the production stack. Gunicorn runs the API with 4 Uvicorn workers, and the frontend serves a pre-built Next.js standalone build.

### 3. Configure TLS and Reverse Proxy

You can expose WikINT securely in two ways: using the built-in Certbot for Let's Encrypt, or using an external reverse proxy (like Cloudflare, Traefik, or an outer Nginx).

#### Option A: Built-in TLS (Certbot / Let's Encrypt)
By default, Nginx starts on port 80 and redirects to HTTPS -- but the HTTPS server will fail without certificates. To bootstrap:

```bash
# Request a certificate from Let's Encrypt
docker compose run certbot certonly --webroot \
  -w /var/www/certbot \
  -d your-domain.com

# Reload nginx to pick up the new certificate
docker compose exec nginx nginx -s reload
```

#### Option B: External Reverse Proxy (e.g., Cloudflare + Outer Nginx)
If you are terminating SSL at an external proxy, you should remove the internal SSL setup to simplify your deployment.

1. **Update `infra/nginx/nginx.conf`**: Modify the internal Nginx to run exclusively on port 80 and remove all SSL settings. It must properly forward the `X-Forwarded-Proto $http_x_forwarded_proto` header. See the [Reverse Proxy Docs](../infrastructure/reverse-proxy.md#deploying-behind-an-external-reverse-proxy) for the exact configuration.
2. **Update `docker-compose.yml`**: Remove the `certbot` service, and change the `nginx` ports to bind locally:
   ```yaml
   ports:
     - "127.0.0.1:9080:80"
   ```
3. Configure your outer proxy to forward traffic to `127.0.0.1:9080`.

### 4. Seed the Database

```bash
docker compose exec api uv run python -m app.cli seed --email "admin@your-domain.com"
```

### 5. Verify

- Visit `https://your-domain.com` -- you should see the login page
- Check `https://your-domain.com/api/health` returns `{"status": "ok"}`
- Verify the MinIO bucket was created: `docker compose logs minio-setup`

---

## Production Differences

When `ENVIRONMENT=production`, the API:

- Disables Swagger UI (`/api/docs` returns 404)
- Disables OpenAPI JSON (`/api/openapi.json` returns 404)
- Disables SQLAdmin
- Disables SQL query logging
- Enables rate limiting (60 requests/minute per IP)

See [Infrastructure Overview](../infrastructure/overview.md) for the full comparison table.

---

## TLS Certificate Renewal

Let's Encrypt certificates expire after 90 days. Renew with:

```bash
docker compose run certbot renew
docker compose exec nginx nginx -s reload
```

Consider setting up a cron job on the host:

```bash
# /etc/cron.d/certbot-renew
0 3 * * 1 cd /path/to/WikINT && docker compose run certbot renew && docker compose exec nginx nginx -s reload
```

---

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
./run.sh --prod
```

After a database schema change, you may need to recreate tables. After changes to search configuration:

```bash
docker compose exec api uv run python -m app.cli reindex
```

---

## Backups

### Database

```bash
# Dump the database
docker compose exec postgres pg_dump -U wikint wikint > backup.sql

# Restore
docker compose exec -T postgres psql -U wikint wikint < backup.sql
```

### File Storage

MinIO data lives in the `minio_data` Docker volume. Back up the volume or use `mc mirror` to sync to another location:

```bash
docker compose exec minio-setup mc mirror local/wikint /backup/
```

### Search Index

Search indexes can be rebuilt from the database at any time:

```bash
docker compose exec api uv run python -m app.cli reindex
```

No separate backup needed.

---

## Monitoring

- **API health**: `GET /api/health` returns `{"status": "ok"}`
- **Container status**: `docker compose ps`
- **Logs**: `docker compose logs -f <service>`
- **Meilisearch health**: `curl http://localhost:7700/health`
- **Redis**: `docker compose exec redis redis-cli ping`
