# ONLYOFFICE Document Server

WikINT uses [ONLYOFFICE Document Server](https://www.onlyoffice.com/office-suite.aspx) to render office documents (DOCX, XLSX, PPTX and their legacy equivalents) with high visual fidelity — including PPTX animations, XLSX cell styling, and DOCX shapes and charts.

All rendering happens within the Docker infrastructure. No document data is sent to external services.

---

## Supported Formats

| Extension | Document Type | Notes |
|-----------|--------------|-------|
| docx, doc | Word processor | Full formatting, shapes, charts, tables |
| xlsx, xls | Spreadsheet | Cell styling, formulas, multiple sheets |
| pptx, ppt | Presentation | Animations, transitions, speaker notes |
| odt | Word processor | OpenDocument text |
| ods | Spreadsheet | OpenDocument spreadsheet |

---

### Security Considerations

- **Authentication:** The ONLYOFFICE container requires a `JWT_SECRET` that matches `ONLYOFFICE_JWT_SECRET` in the API. This ensures only authorized users can generate valid editor configs.
- **File Access:** ONLYOFFICE never touches MinIO directly. The API validates a short-lived file-access token (signed with a separate `ONLYOFFICE_FILE_TOKEN_SECRET` known only to the API) and streams the file bytes to ONLYOFFICE. This means a compromised ONLYOFFICE container cannot forge file-download tokens.
- **Print Trade-off:** The frontend viewer passes `download: false` and `print: true` to the ONLYOFFICE config. This blocks direct file downloads from the ONLYOFFICE UI. However, a user can still use the "Print" function to export the document as a PDF. If strict data exfiltration prevention is required, `print` must be set to `false` in the API configuration (`api/app/routers/onlyoffice.py`) and the print affordance should be removed from the frontend viewer.

### Architecture


```
Browser                         Nginx (:80)                   Docker Network
  |                                |                               |
  |-- loads JS API -------------->| /onlyoffice/ -> onlyoffice:80 |
  |   (once, cached)               |                               |
  |                                |                               |
  |-- GET /api/onlyoffice/ ------->| /api/ --------> api:8000      |
  |   config/{materialId}          |  ↳ validates user JWT         |
  |   <-- signed editor config     |  ↳ issues 5-min file token    |
  |       with internal file URL   |  ↳ signs config w/ OO secret  |
  |                                |                               |
  |  [ONLYOFFICE fetches file:]    |                               |
  |                    onlyoffice:80 ----> api:8000                |
  |                    GET /api/onlyoffice/file/{id}?token=...     |
  |                    ↳ token validated (separate secret)         |
  |                    ↳ file streamed from MinIO                  |
```

**Key points:**
- ONLYOFFICE never has direct access to MinIO. The API validates every file request.
- The browser never receives a raw presigned S3 URL for office files — ONLYOFFICE fetches internally.
- Three distinct JWT secrets are in play: the app's `SECRET_KEY` (user auth), `ONLYOFFICE_JWT_SECRET` (editor config signing, shared with OO), and `ONLYOFFICE_FILE_TOKEN_SECRET` (file-access tokens, API-only).

---

## Security Model

| Concern | Mitigation |
|---------|-----------|
| File access | Short-lived (60 s) single-use JWT scoped to a single `material_id`, signed with a secret known only to the API |
| Token confusion | `type: "onlyoffice_file"` claim prevents reuse of user JWTs |
| Secret isolation | File tokens use `ONLYOFFICE_FILE_TOKEN_SECRET` (API-only); editor configs use `ONLYOFFICE_JWT_SECRET` (shared with OO) |
| Config tampering | Full editor config signed with ONLYOFFICE JWT secret |
| Editing | Disabled via `permissions` — `edit: false` on all document types |
| Data exfiltration | ONLYOFFICE runs on the internal Docker network only |

---

## Resource Requirements

| Resource | Requirement |
|----------|------------|
| RAM | ~1-2 GB (ONLYOFFICE Node.js services) |
| CPU | 1-2 cores recommended |
| Disk | Persistent volume for document cache (`onlyoffice_data`) |
| Startup time | 30-60 seconds on first start |

---

## Configuration

### Environment Variables

```bash
# JWT secret — must match JWT_SECRET on the onlyoffice container
ONLYOFFICE_JWT_SECRET=<generate with: openssl rand -hex 32>

# Separate secret for file-access tokens (API-only, NOT shared with OO).
# Must differ from ONLYOFFICE_JWT_SECRET.
ONLYOFFICE_FILE_TOKEN_SECRET=<generate with: openssl rand -hex 32>

# Browser-facing URL (routed through nginx)
NEXT_PUBLIC_ONLYOFFICE_URL=http://localhost/onlyoffice
```

See [environment-variables.md](../configuration/environment-variables.md) for the full reference.

### Docker Compose

The service is defined in `docker-compose.dev.yml`:
```yaml
onlyoffice:
  image: onlyoffice/documentserver:8.3.0
  environment:
    - JWT_ENABLED=true
    - JWT_SECRET=${ONLYOFFICE_JWT_SECRET}
    - JWT_IN_BODY=true
  volumes:
    - onlyoffice_data:/var/www/onlyoffice/Data
    - onlyoffice_log:/var/log/onlyoffice
```

### Version Pinning and Upgrades

The ONLYOFFICE image is pinned to a specific version (e.g., `8.3.0`) rather than `latest`. This prevents silent, potentially breaking upgrades when pulling new images. ONLYOFFICE occasionally introduces breaking changes to its JWT format or asset paths between minor versions.

To upgrade ONLYOFFICE:
1. Check the [ONLYOFFICE Changelog](https://github.com/ONLYOFFICE/DocumentServer/blob/master/CHANGELOG.md).
2. Update the image tag in `docker-compose.yml` and `docker-compose.dev.yml`.
3. Test document rendering and conversion locally. Pay special attention to JWT validation and asset loading.
4. Commit the new version pin.

### Nginx Proxy

Nginx proxies `/onlyoffice/` to the container at `onlyoffice:80`. This allows the browser to load the ONLYOFFICE JS API from the same origin, avoiding CORS issues.

### Production Deployment

In production, ONLYOFFICE is disabled by default to minimize resource usage and attack surface. To enable it:

1. Run Docker Compose with the `onlyoffice` profile:
   ```bash
   docker compose --profile onlyoffice up -d
   ```
2. Update `nginx.conf` by including the ONLYOFFICE snippet inside your `server` block:
   ```nginx
   include /etc/nginx/nginx.onlyoffice.snippet;
   ```
3. Add `'unsafe-eval'` to the `script-src` in the CSP `map` default entry in `nginx.conf`. The OnlyOffice `api.js` script runs in the parent page context and requires it.
4. Reload Nginx: `docker compose exec nginx nginx -s reload`.
5. Ensure `NEXT_PUBLIC_ONLYOFFICE_URL` is set to `/onlyoffice` (or the appropriate public path) in your environment.

## Scaling Limits

ONLYOFFICE Community Edition is not designed for high concurrency and is limited to approximately 20 concurrent document sessions.
- The `doc_key` implementation uses the material version number, which converts simultaneous page-views into cache hits rather than independent conversion jobs. This is the most impactful mitigation for class-scale access.
- For scenarios requiring 50+ students simultaneously accessing a document, consider pre-converting PPTX/DOCX files to PDF and serving them via the native PDF viewer.
- The Enterprise Edition scales horizontally; upgrading to it may be necessary if usage exceeds these limits.

## Volume Management

The `onlyoffice_data` and `onlyoffice_log` volumes grow unboundedly over time.
- **Typical growth rate:** ~50–200 MB/day of active use (conversion cache + logs).
- **Log rotation command:** `docker compose exec onlyoffice /bin/sh -c "rm -f /var/log/onlyoffice/documentserver/*.log"`
- **Cache clear** (forces re-conversion on next open): `docker compose stop onlyoffice && docker volume rm <project>_onlyoffice_data && docker compose up -d onlyoffice`
- It is recommended to configure a cron job or perform periodic manual reviews on small VPS deployments.

---

## Cache Invalidation

ONLYOFFICE caches rendered documents by a `document.key`. WikINT constructs this key as:

```
{material_id}-v{version_number}
```

When a new file version is uploaded, `version_number` increments and ONLYOFFICE automatically re-fetches and re-renders the document.

---

## Troubleshooting

### Viewer shows "Preview Unavailable"

1. Check ONLYOFFICE container is running: `docker compose ps`
2. Check ONLYOFFICE logs for errors: `docker compose logs onlyoffice`
3. Verify nginx can reach the container: `docker compose exec nginx wget -q -O- http://onlyoffice/healthcheck`

### JWT validation failed (blank iframe or error in OO logs)

The `ONLYOFFICE_JWT_SECRET` in `.env` must exactly match the `JWT_SECRET` environment variable set on the `onlyoffice` container. After changing the secret, restart both services:

```bash
docker compose restart onlyoffice api
```

### ONLYOFFICE cannot fetch the file

Verify the API is reachable from within the ONLYOFFICE container:

```bash
docker compose exec onlyoffice curl http://api:8000/api/health
```

If this fails, check that both services are on the same Docker network.

### Container takes too long to start

ONLYOFFICE initializes multiple internal services on first start. Allow 60 seconds before expecting it to be responsive. The frontend handles this gracefully — opening an office file during startup will show a "Preview Unavailable" error until the service is ready.
