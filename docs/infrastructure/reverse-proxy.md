# Reverse Proxy (Nginx)

Nginx serves as the single entry point for all external traffic. It terminates TLS, routes requests to the API or frontend, and applies security headers.

**Key files**: `infra/nginx/nginx.conf` (production), `infra/nginx/nginx.dev.conf` (development), `docker-compose.yml` (nginx, certbot services)

---

## Production Configuration (`nginx.conf`)

### Routing

```mermaid
graph LR
    Client["Client :443"]

    subgraph Nginx
        HTTPS["HTTPS Server"]
        HTTPS -->|"/api/*"| API["api:8000"]
        HTTPS -->|"/*"| Web["web:3000"]
    end

    HTTP["Client :80"] -->|"301 redirect"| HTTPS
    Client --> HTTPS
```

| Location | Upstream | Notes |
|----------|----------|-------|
| `/api/` | `http://api:8000` | Proxy buffering off, 300s read timeout (for SSE) |
| `/s3/` | `http://minio:9000` | Private file proxy with error interception (see below) |
| `/` | `http://web:3000` | WebSocket upgrade headers set (for HMR in case it leaks) |
| `/.well-known/acme-challenge/` | Filesystem | Certbot ACME challenge files |

### Clean Error Handling (Storage)

To prevent technical XML errors from leaking to users when access links expire or are invalid, Nginx is configured to intercept storage-level errors:

- **Directive**: `proxy_intercept_errors on` inside the `/s3/` block.
- **Interception**: 403 Forbidden errors (commonly "Request has expired" in S3) are caught by Nginx.
- **Custom Page**: Mapped via `error_page 403 =403 /error-expired.html` to a branded, self-contained HTML page (plain inline CSS, no external dependencies) stored in the Nginx container at `/etc/nginx/html/`. The "Go Back" button uses `window.history.back()` for same-tab navigations and `window.close()` for new-tab downloads.
- **Status code preserved**: The `=403` directive ensures the 403 status code is forwarded to the client. This is critical for presigned PUT uploads — without it, the error page would be served with status 200, causing the browser to silently treat a failed upload as successful.

This ensures that even when a security-sensitive link fails, the user remains within the application's visual context.

### SigV4 Host Header

All presigned URLs are signed using **AWS Signature Version 4**, which includes the `host` header in the canonical request. The `/s3/` location sets:

```nginx
proxy_set_header Host "minio:9000";
```

This must match `MINIO_ENDPOINT` (the hostname used when signing). Passing `Host: $host` (the browser's hostname) would cause MinIO to reject the request with a 403 SignatureDoesNotMatch error.

### TLS

- Port 80 redirects all traffic to HTTPS (301)
- Certificates from Let's Encrypt at `/etc/letsencrypt/`
- Protocols: TLSv1.2, TLSv1.3
- Session cache: 10MB shared
- Session timeout: 1440 minutes
- Session tickets: disabled
- Cipher preference: client-side (modern browsers choose best)

### Security Headers

Security headers are defined exclusively in the `server` block for port 443 (not at the `http` block level, which would cause inheritance confusion with `location` blocks).

**443 server block headers**:

| Header | Value |
|--------|-------|
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-XSS-Protection` | `1; mode=block` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer-when-downgrade` |
| `Content-Security-Policy` | Strict policy (no `http://localhost:*` allowed) |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

**`/s3/` location sandboxed CSP**: The `/s3/` location block defines its own restrictive Content-Security-Policy to sandbox user-uploaded content:

```
default-src 'none'; style-src 'unsafe-inline'; sandbox;
```

All other security headers (`X-Frame-Options`, `X-XSS-Protection`, `X-Content-Type-Options`, `Referrer-Policy`, `HSTS`) are repeated in the `/s3/` location block because nginx drops inherited `add_header` directives when a `location` block defines its own `add_header`.

### Proxy Headers

The `/api/` and `/` upstreams receive these headers:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

The `/s3/` upstream uses `Host "minio:9000"` instead of `Host $host` — see [SigV4 Host Header](#sigv4-host-header) above.

The API upstream also has:
- `proxy_read_timeout 300s` — long timeout for SSE connections
- `proxy_buffering off` — required for SSE event streaming

The web upstream also has:
- `proxy_http_version 1.1` — needed for WebSocket upgrade
- `proxy_set_header Upgrade` / `Connection "upgrade"` — WebSocket passthrough

### Global Settings

| Setting | Value |
|---------|-------|
| `worker_processes` | `auto` |
| `worker_connections` | `1024` |
| `client_max_body_size` | `100m` |
| `sendfile` | `on` |
| `tcp_nopush` | `on` |
| `keepalive_timeout` | `65` |

The `client_max_body_size` must be >= `MAX_FILE_SIZE_MB` in `.env` (default 100 MiB) and match the ClamAV `MaxFileSize` limit.

### CORS Handling

In development, Nginx is configured to handle CORS preflight (`OPTIONS`) requests directly and ensure that required headers are present even when the backend is unreachable (e.g., 502 Bad Gateway).

- **Handling `OPTIONS`**: Nginx returns a 204 No Content with `Access-Control-Allow-Credentials: true` and appropriate methods/headers.
- **Proxied Requests**: Nginx adds CORS headers to the response and uses `proxy_hide_header` to prevent duplication with headers provided by the backend.

```nginx
# Example CORS handling for /api/
location /api/ {
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' '$http_origin' always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        # ... methods and headers ...
        return 204;
    }
    # ... proxy pass ...
    proxy_hide_header 'Access-Control-Allow-Origin';
    add_header 'Access-Control-Allow-Origin' '$http_origin' always;
}
```

---

## Development Configuration (`nginx.dev.conf`)

Simplified version without TLS:

- **HTTP only** on port 80 (no HTTPS redirect, no certificates)
- **No security headers** (removed to avoid CSP issues during development)
- **Explicit CORS handling**: Managed at the Nginx level to support browser debugging (see [CORS Handling](#cors-handling))
- Same upstream routing (`/api/` to api, `/` to web)
- Same proxy headers and timeout settings

### Container-to-Container Routing

In Docker, services use their container names for communication. The `web` container uses `API_INTERNAL_URL=http://api:8000` for server-side rewrites, ensuring reliable internal traffic separate from the browser's public-facing requests.

The dev compose overlay generates a self-signed certificate on startup:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/nginx.key \
  -out /etc/nginx/ssl/nginx.crt \
  -subj '/CN=localhost'
```

However, `nginx.dev.conf` only listens on port 80, so the self-signed cert is available but not actively used by nginx in dev mode.

---

## TLS Certificate Management

The `certbot` service is defined in `docker-compose.yml` but runs on-demand (not as a persistent service):

```yaml
certbot:
  image: certbot/certbot
  volumes:
    - ./infra/nginx/ssl:/etc/letsencrypt
    - ./infra/nginx/certbot-webroot:/var/www/certbot
```

### Initial Certificate

```bash
docker compose run certbot certonly --webroot \
  -w /var/www/certbot \
  -d yourdomain.com
```

### Renewal

```bash
docker compose run certbot renew
docker compose exec nginx nginx -s reload
```

The ACME challenge directory is served by nginx at `/.well-known/acme-challenge/` from `/var/www/certbot`.

---

## Docker Setup

```yaml
nginx:
  image: nginx:alpine
  volumes:
    - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    - ./infra/nginx/ssl:/etc/letsencrypt
    - ./infra/nginx/certbot-webroot:/var/www/certbot
  ports:
    - "80:80"
    - "443:443"
  depends_on:
    - api
    - web
```

Nginx starts after both `api` and `web` are running (but does not wait for their health checks -- it relies on upstream health for actual request routing).

---

## Deploying Behind an External Reverse Proxy

If you are using Cloudflare, Traefik, or an external Nginx instance to terminate SSL, you can simplify WikINT's internal configuration to run entirely on HTTP.

### 1. Update Internal Nginx
Modify `infra/nginx/nginx.conf` to remove the `443` server block, remove all SSL certificates, and run exclusively on port `80`. 

Crucially, ensure you pass the protocol from the outer proxy to the inner upstreams using the `$http_x_forwarded_proto` header so WikINT knows requests are actually secure:
```nginx
proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
```

### 2. Update Docker Compose
In `docker-compose.yml`, remove the `certbot` service entirely. Update the `nginx` service to bind locally to a custom port (e.g., `9080`):
```yaml
  nginx:
    restart: unless-stopped
    image: nginx:alpine
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infra/nginx/error-expired.html:/etc/nginx/html/error-expired.html:ro
    ports:
      - "127.0.0.1:9080:80"
    depends_on:
      - api
      - web
```

### 3. Outer Proxy Configuration (Example)
Your external reverse proxy MUST properly handle large uploads and Server-Sent Events (SSE) for WikINT to function correctly. 

Here is a typical Nginx configuration for the outer proxy:

```nginx
server {
   listen 80;
   server_name wikint.your-domain.com;
   return 301 https://$host$request_uri;
}

server {
   listen 443 ssl http2;
   server_name wikint.your-domain.com;
   
   ssl_certificate /path/to/cert.pem;
   ssl_certificate_key /path/to/key.pem;

   # 1. REQUIRED: Allow large file uploads (Matches MAX_FILE_SIZE_MB)
   client_max_body_size 100m;

   location / {
      proxy_pass http://127.0.0.1:9080;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      
      # 2. REQUIRED: Tell WikINT the connection is secure
      proxy_set_header X-Forwarded-Proto $scheme;

      # Websocket support
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
   }

   # 3. REQUIRED: Disable buffering for the API (for SSE)
   location /api/ {
      proxy_pass http://127.0.0.1:9080/api/;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      
      # Disable buffering for real-time notifications to work
      proxy_buffering off;
      proxy_read_timeout 300s;
   }
}
```

**Note on Cloudflare:**
If proxying through Cloudflare, the `X-Real-IP` will be Cloudflare's IP. To ensure WikINT's rate limiting and audit logs function correctly, configure your outer Nginx to restore the real client IP using the `set_real_ip_from` directives and `real_ip_header CF-Connecting-IP;` in the `http { ... }` block.
