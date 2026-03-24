# OnlyOffice Integration Review — WikINT

Reviewed across: Security · Architecture · UX · Frontend · Performance

Date: 2026-03-22

---

## Security

### Strengths

- **Dual-secret architecture is correct.** `SECRET_KEY` (user auth) and `ONLYOFFICE_JWT_SECRET` (OO integration) are completely separate. No user JWT can be replayed against the file endpoint.
- **Token-type claim prevents confusion attacks.** `"type": "onlyoffice_file"` is explicitly verified in `_verify_file_token`. A config token or user token cannot impersonate a file token even if they share the secret.
- **Token is scoped to a single material.** The `sub` claim is bound to `material_id` and verified on every call. Token A cannot download file B.
- **Full editor config is JWT-signed.** The entire config dict is signed before being returned to the browser. ONLYOFFICE rejects any client-side tampering with permissions, mode, or file URL.
- **ONLYOFFICE never touches MinIO.** File access is mediated 100% through the API. No presigned URLs are handed to the browser or to ONLYOFFICE.
- **All permissions except `print` are `false`.** `edit`, `download`, `comment`, `review`, `fillForms`, `modifyContentControl`, `modifyFilter` are all locked off. `plugins: false` closes the plugin execution surface.
- **ONLYOFFICE is absent from the production compose.** The feature does not exist in the production attack surface by default.
- **Network segmentation isolates the data tier.** The backend network (Postgres, Redis, MinIO) is unreachable from the OO container.

### Issues

| ID | Severity | Issue |
|----|----------|-------|
| S-1 | **Critical** | Weak default secret `"change-me-onlyoffice-jwt-secret"` has no startup guard. If an operator doesn't set `ONLYOFFICE_JWT_SECRET`, any attacker who knows the public default can forge a file token and download any material's raw bytes without user authentication — `serve_file_to_onlyoffice` has no `CurrentUser` check. |
| S-2 | **Low** | File token is in the URL query string (`?token=...`). Logged in plaintext by Gunicorn, Nginx, and OO. Mitigated: tokens are single-use (consumed atomically via Redis) with a 60s TTL, and this is an internal container-to-container URL never exposed to browsers. `document.requestHeaders` was tested but ONLYOFFICE 8.3's file downloader does not forward custom headers. |
| S-3 | **High** | `Content-Disposition: attachment; filename="{file_name}"` is constructed from a user-supplied filename without sanitization. A filename with `"`, `\r`, or `\n` can inject arbitrary HTTP response headers (CRLF injection). **Fix:** RFC 5987-encode with `urllib.parse.quote`. |
| S-4 | **High** | `/api/onlyoffice/file/{id}` has no user authentication. Token possession = file access. A shared or logged token grants file download to anyone. Mitigate by (a) reducing TTL from 300s to 60s and (b) making the token single-use via a Redis key consumed on first verification. |
| S-5 | **Medium** | Nginx proxies the entire ONLYOFFICE HTTP surface under `/onlyoffice/` and via the `^/(cache|web-apps|sdkjs|…)` regex. The converter endpoint, WebSocket doc sessions, and internal admin paths are all reachable from the public network. `JWT_ENABLED=true` mitigates direct converter abuse, but path restriction at the Nginx layer is the correct defense-in-depth posture. |
| S-6 | **Medium** | `onlyoffice/documentserver:latest` is the only unpinned image in the stack. Every `docker compose pull` silently upgrades ONLYOFFICE. OO has a history of CVEs in its Node.js services and has had breaking changes to its JWT format and asset paths between minor versions. |
| S-7 | **Medium** | Production CSP (`frame-src 'self'`) does not explicitly account for ONLYOFFICE. Dev nginx config has **no CSP at all**. When OO is added to production, `frame-src` must be updated and the dev template should have a baseline CSP. |
| S-8 | **Medium** | `get_onlyoffice_config` calls `get_material_with_version` without passing the authenticated user. If other material endpoints enforce directory-level visibility or group membership, those checks are bypassed here. Any authenticated user can generate a config (and therefore a file token) for any material regardless of directory permissions. Audit and align with the rest of the access control layer. |
| S-9 | **Low** | `print: true` is an indirect exfiltration path. ONLYOFFICE generates a full print-ready PDF via `/printfile/` that the browser downloads. This bypasses `download: false`. If preventing document exfiltration is a hard requirement, set `print: false`. Document this trade-off explicitly. |

### Implementation Plans

**S-1 — Startup guard for weak default secret**
Confirmed genuine: `config.py:59` has the placeholder default with no validator.

In `api/app/config.py`, add a `model_validator(mode='after')` to `Settings` that raises `ValueError` if `onlyoffice_jwt_secret` equals the placeholder. Raise unconditionally (not only in production) — a weak secret in dev trains operators to skip the step.

```python
from pydantic import model_validator

@model_validator(mode='after')
def _check_onlyoffice_secret(self) -> 'Settings':
    if self.onlyoffice_jwt_secret == "change-me-onlyoffice-jwt-secret":
        raise ValueError(
            "ONLYOFFICE_JWT_SECRET must be set. "
            "Generate one: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    return self
```

Update `docker-compose.dev.yml` to set a non-placeholder value in the OO container's env: `JWT_SECRET=${ONLYOFFICE_JWT_SECRET:-insecure-dev-only-onlyoffice-secret}` — keeping the container working without forcing operators to always set the var in dev, while the API validator catches production deployments that forget to set `ONLYOFFICE_JWT_SECRET`. Add `ONLYOFFICE_JWT_SECRET` to `.env.example` with the generation command.

**S-2 — File token in URL query string (accepted risk)**
`document.requestHeaders` was tested but ONLYOFFICE 8.3's converter/downloader does NOT forward custom headers when fetching `document.url`. The token remains in the query string as a known trade-off. Mitigated by:
- Single-use JTI consumed atomically via Redis (no replay)
- 60-second TTL (was 300s)
- Internal container-to-container URL, never exposed to browsers
- Separate signing secret (`ONLYOFFICE_FILE_TOKEN_SECRET`) unknown to the OO container

**S-3 — RFC 5987-encode Content-Disposition filename**
Confirmed genuine: `onlyoffice.py:156` uses the filename verbatim inside double-quotes.

In `serve_file_to_onlyoffice`, replace:
```python
"Content-Disposition": f'attachment; filename="{file_name}"',
```
with:
```python
from urllib.parse import quote
ascii_safe = file_name.encode("ascii", errors="replace").decode("ascii").replace('"', "_").replace("\r", "").replace("\n", "")
encoded = quote(file_name, safe="")
"Content-Disposition": f'attachment; filename="{ascii_safe}"; filename*=UTF-8\'\'{encoded}',
```
RFC 5987 extended notation eliminates CRLF injection entirely. The ASCII fallback covers clients that do not implement RFC 5987.

**S-4 — Reduce token TTL and make tokens single-use**
Confirmed genuine: 300s TTL gives a meaningful exfiltration window if a token is logged.

Two-step fix:
1. **TTL reduction (trivial):** Change `onlyoffice_file_token_ttl: int = 300` to `onlyoffice_file_token_ttl: int = 60` in `config.py`.
2. **Single-use via Redis (medium):** Add a `jti` claim (`secrets.token_hex(16)`) to `_create_file_token`. Store `onlyoffice:jti:{jti}` in Redis with the same TTL. In `_verify_file_token`, after successful JWT decode, atomically `DELETE onlyoffice:jti:{jti}` and reject if the key was absent (token already consumed). Inject Redis via the existing `app.core.redis` module. A replayed token is rejected immediately regardless of TTL.

**S-5 — Nginx path allowlist for OO internal surface**
Confirmed genuine: the current config exposes the converter, coauthoring, and admin paths.

In both nginx configs, add an explicit block **before** the asset regex to deny known OO-internal paths:
```nginx
location ~* ^/(coauthoring|converter|info|healthcheck)/ {
    return 403;
}
```
This preserves all asset paths while blocking paths that should never be reached from the public network. `JWT_ENABLED=true` already mitigates converter abuse, but defense-in-depth at the proxy layer is the correct posture. Also add `proxy_read_timeout 300s` to the asset regex block (addresses P-5 simultaneously).

**S-6 — Pin ONLYOFFICE image to a specific version**
Confirmed genuine: `docker-compose.dev.yml:65` uses `latest`.

Change to a specific release tag:
```yaml
image: onlyoffice/documentserver:8.3.0
```
Document the pinned version in `docs/infrastructure/onlyoffice.md` with an upgrade procedure: check the OO changelog, update the pin, test locally (pay attention to JWT format changes between minor versions), then commit.

**S-7 — Add baseline CSP to dev nginx template**
Confirmed genuine: the dev template has zero security headers; production has hardened CSP.

In `nginx.dev.conf.template`, add inside the `server` block:
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self'; connect-src 'self' ws://localhost wss://localhost;" always;
```
Because OO is served from the same origin in dev (`localhost/onlyoffice/`), `frame-src 'self'` is sufficient. This gives developers early signal when a code change would break the production CSP.

**S-8 — Authorization consistency in get_onlyoffice_config**
Confirmed: `get_material_with_version` has no user-specific filtering beyond requiring authentication — which matches every other material endpoint. There is no directory-level ACL in the codebase today, so S-8 is currently not exploitable.

Defensive fix: add a `check_material_access(user_id, material)` stub in `services/material.py` that today always passes, but is the single choke-point for future ACL additions. Call it from `get_onlyoffice_config` and `get_material` (materials router). When per-directory ACL is added, only `check_material_access` needs updating — the OO endpoint cannot regress by omission.

**S-9 — Document the print/exfiltration trade-off**
Confirmed genuine (Low). No code change needed.

Add a comment above `"print": True` in `onlyoffice.py`:
```python
# print: True — students can print or export to PDF via OO's menu.
# Intentional trade-off: "download: false" blocks direct file download but
# cannot prevent print-to-PDF. To enforce full exfiltration prevention,
# set print: False and remove the print affordance from the frontend.
```
Also document this trade-off in `docs/infrastructure/onlyoffice.md`.

---

## Architecture

### Strengths

- **Tool selection is correct.** Alternatives are all disqualifying for this context: Google Docs sends data externally; LibreOffice headless adds pipeline complexity with lower PPTX fidelity; converting to PDF requires a full async conversion queue. ONLYOFFICE self-hosted satisfies the data-sovereignty requirement with best-in-class format fidelity.
- **Network isolation is sound.** OO sits only on `frontend` and can reach `api:8000` but has no path to Postgres, Redis, MinIO, Meilisearch, or ClamAV. This correctly minimizes blast radius if OO is compromised.
- **The file serving chain is justified.** `OO → API → MinIO` is longer than `OO → MinIO` directly, but the indirection enforces authorization on every file fetch. MinIO credentials and presigned URLs stay fully out of OO's reach.
- **The React DOM integration is correct.** The imperative `editorDiv` pattern (appending outside React's vdom to an always-childless container ref) is the standard solution to the OO/React reconciler conflict. The comment explains exactly why.
- **Lazy nginx upstream resolution is correct.** `set $onlyoffice_upstream http://onlyoffice` forces DNS resolution at request time via Docker's `127.0.0.11`, preventing Nginx startup failure during OO's 30-60 second cold start.

### Issues

| ID | Severity | Issue |
|----|----------|-------|
| A-1 | **High** | Production compose gap. `docker-compose.yml` has no `onlyoffice` service and no corresponding Nginx routing. The API endpoint succeeds but the frontend silently fails. The docs only cover the dev path. A production operator adding OO needs to update both the compose file and the Nginx config — an undocumented multi-file dependency. |
| A-2 | **High** | `file_url = f"http://api:8000/…"` hardcodes both the service name and port as string literals. This breaks silently on any rename, port change, or non-Docker deployment. Should be `settings.onlyoffice_internal_api_base_url` with default `http://api:8000`. |
| A-3 | **Medium** | No circuit breaker or script-load timeout. If OO is slow to start, `loadOnlyOfficeScript` hangs with only a spinner for up to the 300s Nginx `proxy_read_timeout`. Students see a frozen loading state, not an error they can act on. A 15-20 second `Promise.race` timeout would surface a recoverable error promptly. |
| A-4 | **Medium** | The `^/(cache|web-apps|sdkjs|sdkjs-plugins|fonts|dictionaries|meta|printfile)/` regex block at root level creates namespace pollution. Any future WikINT route starting with these prefixes is silently hijacked to OO. `/cache/`, `/meta/`, `/fonts/` are particularly plausible future paths. |
| A-5 | **Medium** | OO Community Edition is not designed for high concurrency. At 50 simultaneous students opening the same document: 50 independent full conversions queued against ~2-4 Node.js workers, 50 file fetches from the API, and (with the current random nonce) 50 independent MinIO reads. This will OOM the API container (512 MB reserved). This ceiling is nowhere documented. |
| A-6 | **Medium** | `onlyoffice_data` volume has no size limit and no documented clear procedure. OO stores intermediate conversion cache and document state here indefinitely. On a small VPS this will grow unboundedly. |
| A-7 | **Low** | No memory limit on the OO container in dev compose. No `deploy.resources` block. OO can consume all available RAM and OOM-kill other services silently. Compare: all other services have reservations set. |
| A-8 | **Low** | `HEAD` response returns `Content-Length` from the DB record (`version.file_size`), not a live MinIO `head_object`. If the DB record is stale, ONLYOFFICE gets a mismatched Content-Length vs. actual bytes, which can trigger its `errorCode: -4` ("Download failed"). |

### Implementation Plans

**A-1 — Production compose and Nginx for OO**
Confirmed genuine: `docker-compose.yml` has no `onlyoffice` service and no OO Nginx routing.

Add an `onlyoffice` service to `docker-compose.yml` behind the `profiles: ["onlyoffice"]` key so it is explicitly opt-in and does not run by default:
```yaml
onlyoffice:
  image: onlyoffice/documentserver:8.3.0
  profiles: ["onlyoffice"]
  restart: unless-stopped
  environment:
    - JWT_ENABLED=true
    - JWT_SECRET=${ONLYOFFICE_JWT_SECRET}
    - JWT_IN_BODY=true
  networks:
    - frontend
  volumes:
    - onlyoffice_data:/var/www/onlyoffice/Data
    - onlyoffice_log:/var/log/onlyoffice
  deploy:
    resources:
      limits:
        memory: 2G
      reservations:
        memory: 1G
```
Add the corresponding `onlyoffice_data` and `onlyoffice_log` volumes to `docker-compose.yml`. Add an `nginx.onlyoffice.snippet` (or inline block in the production `nginx.conf`) documenting the required `/onlyoffice/` location and asset regex blocks, copied from the dev template. Update `docs/infrastructure/onlyoffice.md` with the full production enable procedure: run with `--profile onlyoffice`, add nginx snippet, set `NEXT_PUBLIC_ONLYOFFICE_URL`.

**A-2 — Config-driven internal API base URL**
Confirmed genuine: `onlyoffice.py:79` hardcodes `http://api:8000`.

In `api/app/config.py`, add:
```python
onlyoffice_internal_api_base_url: str = "http://api:8000"
```
In `api/app/routers/onlyoffice.py`, replace the literal with:
```python
file_url = f"{settings.onlyoffice_internal_api_base_url}/api/onlyoffice/file/{material_id}"
```
Add `ONLYOFFICE_INTERNAL_API_BASE_URL` to `.env.example` with the default value and a comment explaining it is the service-internal URL that ONLYOFFICE's backend uses to fetch files (never the public URL).

**A-3 — Script-load timeout (circuit breaker)**
Confirmed genuine: `loadOnlyOfficeScript` hangs indefinitely if OO is slow; `proxy_read_timeout 300s` means up to 5 minutes of a frozen spinner.

In `office-viewer.tsx`, add a `withTimeout` helper and wrap the `loadOnlyOfficeScript()` call:
```typescript
const SCRIPT_LOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
    ]);
}

// In init():
await withTimeout(loadOnlyOfficeScript(), SCRIPT_LOAD_TIMEOUT_MS, "ONLYOFFICE service did not respond in time");
```
The timeout error is caught by the existing `catch` block and surfaces the error message to the user within 20 seconds instead of 300.

**A-4 — OO asset path namespace pollution**
Confirmed genuine: the root-level regex `^/(cache|web-apps|sdkjs|...)` would silently hijack future WikINT routes starting with those prefixes.

Short-term: add a comment in both nginx configs listing the known conflicts (`/cache/`, `/meta/`, `/fonts/`) and enforce a check in code review for new Next.js routes with these prefixes.

Medium-term (preferred): Configure ONLYOFFICE to use `/onlyoffice` as its base path so all its assets are served under the existing `/onlyoffice/` location block. This eliminates the root-level regex block entirely. ONLYOFFICE exposes this via the `nginx` config inside the container (the `documentserver.conf` listen path). Document the configuration in `docs/infrastructure/onlyoffice.md`.

**A-5 — Document Community Edition concurrency ceiling**
Confirmed genuine (Architecture concern, no code fix needed).

In `docs/infrastructure/onlyoffice.md`, add a "Scaling limits" section:
- Community Edition is limited to approximately 20 concurrent document sessions.
- P-1 fix (stable `doc_key`) converts simultaneous page-views into cache hits instead of 30 independent conversion jobs, which is the most impactful mitigation.
- For class-scale simultaneous access (50+ students), consider pre-converting PPTX/DOCX to PDF and serving via the PDF viewer for bulk scenarios.
- Enterprise Edition scales horizontally; document the upgrade path.

**A-6 — Document volume management and growth bounds**
Confirmed genuine: `onlyoffice_data` and `onlyoffice_log` volumes grow unbounded.

In `docs/infrastructure/onlyoffice.md`, add a "Volume management" section documenting:
- Typical growth rate: ~50–200 MB/day of active use (conversion cache + logs).
- Log rotation command: `docker compose exec onlyoffice /bin/sh -c "rm -f /var/log/onlyoffice/documentserver/*.log"`
- Cache clear (forces re-conversion on next open): `docker compose stop onlyoffice && docker volume rm <project>_onlyoffice_data && docker compose up -d onlyoffice`
- Recommend a cron job or periodic manual review on small VPS deployments.

**A-7 — Memory limit on OO container in dev**
Confirmed genuine: `docker-compose.dev.yml` has no resource block for `onlyoffice`.

Add to the `onlyoffice` service in `docker-compose.dev.yml`:
```yaml
deploy:
  resources:
    limits:
      memory: 2G
    reservations:
      memory: 1G
```
This prevents OO from consuming all available RAM and OOM-killing other dev services (Postgres, API, etc.). OO needs ~1 GB to start and ~1.5 GB at peak during document conversion.

**A-8 — HEAD Content-Length accuracy**
Confirmed genuine: `onlyoffice.py:157` uses `version.file_size` from the DB, which may be stale.

Simplest fix: remove `Content-Length` from the HEAD response. ONLYOFFICE only requires 2xx from HEAD to confirm the URL is reachable; it does not validate Content-Length against actual bytes at the HEAD stage.
```python
if request.method == "HEAD":
    # Content-Length intentionally omitted: HEAD is only used by OO to verify
    # URL reachability. A stale DB value would cause errorCode: -4.
    return Response(media_type=mime_type)
```
If future OO versions require Content-Length on HEAD, switch to calling `get_object_info(version.file_key)` (already in `minio.py:85`) and cache the result in Redis with a 60s TTL to avoid per-request S3 calls.

---

## UX

### Strengths

- **Cancellation is handled correctly.** Navigating away mid-load cancels state updates, destroys the editor, and removes the DOM node. No ghost spinners or stale state.
- **Error state replaces the viewer shell.** Prevents a broken empty iframe; students see a definitive failure message.
- **Download is always available independently.** If the viewer fails, the header/FAB download button is still functional.
- **Permissions lockdown removes editing chrome.** Disabling chat, comments, help, right menu, toolbar tabs is correct for a view-only context and reduces cognitive load.

### Issues

| ID | Severity | Issue |
|----|----------|-------|
| U-1 | **High** | **Loading feedback is a single 24px spinner for a 2–12s process.** The PDF viewer shows an A4 skeleton. The office viewer shows nothing except a rotating ring. Students have no indication of progress stage, whether anything is happening, or how long to wait. |
| U-2 | **High** | **Cold start produces an immediate "Preview Unavailable" error** with no retry and no indication that the service will be ready in 30 seconds. There is no distinction between "service permanently down" and "service initializing." |
| U-3 | **High** | **Mobile is structurally broken.** OO embedded mode renders desktop-scale documents inside the iframe. On 375px viewports this requires horizontal scrolling within the iframe. The Print FAB button appears on mobile but its action is a toast telling users to tap a button inside the desktop-scale OO toolbar — a button they can't reliably reach on touch. |
| U-4 | **Medium** | **Loading state is not reset when `materialId` changes.** Navigate from document A (loaded, `loading === false`) to document B: no spinner appears during document B's load. Students see an empty frame with no feedback until `onDocumentReady` fires. |
| U-5 | **Medium** | **Three different error messages, none actionable.** "ONLYOFFICE preview service is unavailable", "Failed to load document preview", "Document preview service is unavailable. Please download the file to view it." — all render the same "Preview Unavailable" heading. Students can't distinguish a file-level failure from a service outage. Only the catch-all message mentions downloading, but there's no download button in the error state — just plain text. |
| U-6 | **Medium** | **Print fallback is a toast pointing at ONLYOFFICE's internal ⋮ menu** — ephemeral, assumes knowledge of OO's UI, and appears in two different forms at different loading stages. On mobile it's a false affordance (button visible, result is always a toast). |
| U-7 | **Medium** | **Empty left toolbar.** The flex toolbar has a placeholder comment and renders nothing. The PDF viewer uses the same space for page indicator, zoom controls, and keyboard shortcut hints. Candidates: filename/document-type badge, page count, retry button when in error state. |
| U-8 | **Medium** | **Iframe has no accessible name.** The OO `DocEditor` creates an iframe that screen readers announce as unlabeled. The `FullscreenToggle` uses `title` but not `aria-label`. |
| U-9 | **Low** | **Fullscreen is silent-fail on iOS Safari.** `requestFullscreen` on a div is not supported on iOS Safari. `toggleFullscreen` has no error handling beyond `console.error`. Users tap the button and nothing happens. |

### Implementation Plans

**U-1 — Multi-stage loading feedback**
Confirmed genuine: the office viewer shows only a 24px spinner for a 2–12s process; the PDF viewer shows a page skeleton.

Replace the spinner with a two-phase skeleton in `office-viewer.tsx`:
1. **Phase 1** (config fetch + script load, ~0–3s): render an animated `animate-pulse` skeleton — a full-width rectangle with 5 grey bars mimicking document lines, matching the height of the viewer.
2. **Phase 2** (OO initialization, ~3–12s): keep the skeleton and add a status label below it ("Initializing viewer…") updated by a `loadingStage` state (`"config" | "script" | "editor"`). Set stage after each `await` in `init()`.
3. `onDocumentReady` fires when OO finishes rendering — call `setLoadingStage("ready")` / `setLoading(false)` there.

**U-2 — Cold-start detection and retry**
Confirmed genuine: a script-load timeout or network error immediately shows a permanent opaque error with no retry.

In the `catch` block, distinguish error kinds:
- **Timeout / network errors** (OO unavailable during cold start): set `errorKind: "cold_start"`, show "Viewer is starting up — retrying…", auto-retry after 15s, up to 3 times.
- **Permanent errors** (bad file, format unsupported): set `errorKind: "document"`, show the diagnostic message with a download button.

Track `retryCount` in state and add it to the `useEffect` dependency array. Auto-retry is implemented by incrementing `retryCount` on a `setTimeout` inside the catch block (only for cold-start errors). Cancel the timer in the effect cleanup via `clearTimeout`.

**U-3 — Mobile experience**
Confirmed genuine: OO embedded mode is desktop-scale and the print button is a false affordance on mobile.

Add a `useMediaQuery("(max-width: 767px)")` hook (or check `window.innerWidth` inside the effect). On mobile:
- Skip OO entirely. Render a banner instead: "This document is best viewed on a desktop. Download to open it locally."
- Show a download button that calls `/api/materials/{materialId}/download-url` via the existing `apiFetch`.
- Hide the print FAB — the `registerOfficePrint` call is skipped on mobile.

This is the most reliable mobile UX: no OOM from a conversion attempt on mobile browsers, clear call-to-action.

**U-4 — Loading state not reset when materialId changes**
Confirmed genuine. This is the same root cause as F-1 — addressed by the F-1 plan.

**U-5 — Normalize error messages with actionable download button**
Confirmed genuine: three distinct error strings at lines 101, 143, and 153; none includes a download affordance.

Define an `ErrorKind` type and map each to a single user-facing message:
```typescript
type ErrorKind = "script" | "doc" | "service";
const ERROR_MESSAGES: Record<ErrorKind, string> = {
    script: "Preview service is starting up.",
    doc: "This document couldn't be rendered. Check the file format.",
    service: "Preview is unavailable.",
};
```
In the error state JSX, always render a download button alongside the message:
```tsx
<a href={downloadUrl} download className="btn">
    Download file
</a>
```
Pass `downloadUrl` as a prop or derive it from the API using `materialId`. The three separate `setError(string)` calls are replaced with `setError(kind: ErrorKind)`.

**U-6 — Print affordance improvement**
Confirmed genuine: the toast fallback is ephemeral, cross-origin aware but user-hostile.

Replace the toast with an inline popover (using the existing Shadcn `Popover` component) that:
- Appears anchored to the print button
- Shows an illustration (or arrow) pointing at the OO ⋮ menu
- Stays visible until dismissed by the user (not ephemeral)
- Is hidden entirely on mobile (covered by U-3)

Keep the existing same-origin direct-click path unchanged — it works correctly and should remain the primary path.

**U-7 — Left toolbar content**
Confirmed genuine: `office-viewer.tsx:193–195` has a `<div>` with only a placeholder comment.

Populate the left toolbar with a document-type badge using the `fileName` prop (once F-2 makes it used):
```tsx
{!loading && fileName && (
    <span className="text-xs font-medium uppercase text-muted-foreground px-1">
        {fileName.split(".").pop()?.toUpperCase()}
    </span>
)}
```
When in error state, show a retry button here (wired to F-4's `retryCount` increment). Remove `justify-between` from the parent if the left side stays empty at loading time (change to `justify-end`).

**U-8 — Accessible iframe name**
Confirmed genuine: the OO `DocEditor` creates an unlabeled iframe; the `FullscreenToggle` has `title` but not `aria-label`.

In `onDocumentReady`, locate the OO iframe and set its accessible name:
```typescript
onDocumentReady: () => {
    const iframe = containerRef.current?.querySelector("iframe");
    if (iframe) {
        iframe.setAttribute("title", `Document preview: ${fileName}`);
        iframe.setAttribute("aria-label", `Document preview: ${fileName}`);
    }
    // ...
}
```
In `FullscreenToggle`, add `aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}` alongside the existing `title` attribute.

**U-9 — Fullscreen graceful degradation on iOS Safari**
Confirmed genuine: `use-fullscreen.ts` calls `requestFullscreen` unconditionally; iOS Safari does not support it on a div.

In `use-fullscreen.ts`, detect support before exposing the toggle:
```typescript
const supportsFullscreen =
    typeof document !== "undefined" &&
    !!(document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);

return { isFullscreen, toggleFullscreen, supportsFullscreen };
```
In `FullscreenToggle`, hide the button when `!supportsFullscreen` rather than showing a no-op control. Optionally, on iOS Safari, offer a "Open in full page" link that navigates to a dedicated `/view/{materialId}` route with no chrome.

---

## Frontend Code

### Strengths

- **`cancelled` flag pattern is well-implemented.** Two `if (cancelled) return` guards after each `await` correctly prevent stale state updates and double-editor init on unmount/remount.
- **Script deduplication pattern is correct.** Module-level `scriptLoadPromise` with error-path nulling is the right approach for one-time third-party script injection in an SPA.
- **Cleanup order is correct.** `destroyEditor()` → `removeChild()` in the effect destructor matches ONLYOFFICE's expected teardown sequence.
- **Editor config security is layered correctly.** `edit: false` locked on the server, then signed as a JWT; `type: "embedded"` forced on the client overriding any server value.

### Issues

| ID | Severity | Issue |
|----|----------|-------|
| F-1 | **Bug** | **`loading` is not reset to `true` when `materialId` changes.** `useState(true)` only applies to the first mount. On navigation to a second document, `loading` stays `false` and the spinner never appears. Fix: add `setLoading(true); setError(null)` at the top of the `useEffect` body. |
| F-2 | **Bug** | **`OfficeViewerProps` declares `fileKey`, `fileName`, `mimeType` but only `materialId` is destructured and used.** The interface creates a misleading contract — callers believe these props affect rendering. Annotate them (`// unused: ONLYOFFICE fetches its own config`) or make them optional. |
| F-3 | **Medium** | **`onError` event typed as `{ data?: unknown }`.** The OO API documents `data` as a number error code (`-1` unknown, `-2` conversion timeout, `-4` download failed, etc.). `-4` is the most common failure in self-hosted OO (misconfigured internal URL) and should show a distinct diagnostic message. |
| F-4 | **Medium** | **No retry affordance in the error state.** Once `error` is set, the component is permanently broken until the user navigates away. A `retryCount` state added to the effect dependency array would allow retry without a page reload — critical for cold-start scenarios. |
| F-5 | **Low** | **`(window as Record<string, unknown>).DocsAPI` cast appears twice.** Replace both with a module-level `interface OnlyOfficeDocsAPI` declaration. Makes the intentional incompleteness explicit and avoids casting the hot path. |
| F-6 | **Low** | **`Math.random()` in `editorId` is unnecessary.** Since there is only one `containerRef` and one `editorDivRef` per instance and cleanup always removes the previous div, `materialId` alone is sufficient. The random suffix creates a minor latent leak when `containerRef.current` is null at append time. |
| F-7 | **Nit** | **Dead markup in the left toolbar.** The empty `<div>` with a placeholder comment renders dead space. Remove it (and `justify-between` on the parent) until there's actual content. |

### Implementation Plans

**F-1 — Reset loading state when materialId changes**
Confirmed genuine: `useState(true)` only applies to the first mount; navigating to a second document shows no spinner.

At the top of the `useEffect` body, before the `init()` call, add:
```typescript
setLoading(true);
setError(null);
```
This ensures every `materialId` change triggers a visible loading state. One-line fix; no architectural change needed.

**F-2 — Clarify unused OfficeViewerProps fields**
Confirmed genuine: `fileKey`, `fileName`, `mimeType` are declared in the interface but not destructured or used (`office-viewer.tsx:47`).

The preferred fix is to use these props rather than just annotate them — `fileName` is needed for U-5 (error state download) and U-7 (type badge), `mimeType` could seed the error message for unsupported types. Make them required and destructure them:
```typescript
export function OfficeViewer({ materialId, fileName, mimeType }: OfficeViewerProps)
```
If keeping them unused for now, annotate clearly:
```typescript
interface OfficeViewerProps {
    materialId: string;
    // Below: unused by OfficeViewer — ONLYOFFICE fetches its own config from the API.
    // Kept for interface parity with PdfViewer; will be used by U-5/U-7 improvements.
    fileKey: string;
    fileName: string;
    mimeType: string;
}
```

**F-3 — Typed OO error codes with actionable messages**
Confirmed genuine: `onError` is typed as `{ data?: unknown }` (`office-viewer.tsx:140`); OO documents `data` as a numeric error code.

Replace with a typed handler:
```typescript
const OO_ERROR_MESSAGES: Partial<Record<number, string>> = {
    [-1]: "Unknown error in document viewer.",
    [-2]: "Conversion timed out. The document may be too large.",
    [-4]: "Document download failed. The preview service may be misconfigured.",
};

onError: (event: { data?: number }) => {
    const code = event?.data;
    const msg =
        typeof code === "number" && OO_ERROR_MESSAGES[code]
            ? OO_ERROR_MESSAGES[code]!
            : "Failed to load document preview.";
    if (!cancelled) { setError(msg); setLoading(false); }
},
```
Error code `-4` ("Download failed") is the most common failure in self-hosted OO (misconfigured internal URL) and deserves a distinct diagnostic message.

**F-4 — Retry affordance in error state**
Confirmed genuine: once `error` is set, the component is permanently broken until navigation.

Add `retryCount` to state:
```typescript
const [retryCount, setRetryCount] = useState(0);
```
Add it to the `useEffect` dependency array so incrementing it triggers a fresh init attempt. In the error state JSX, show a retry button (capped at 3 attempts):
```tsx
{retryCount < 3 && (
    <button
        onClick={() => { setError(null); setLoading(true); setRetryCount(c => c + 1); }}
        className="btn"
    >
        Retry
    </button>
)}
```
After 3 failures, show a permanent error with a download link (U-5).

**F-5 — Module-level DocsAPI type declaration**
Confirmed genuine: `(window as Record<string, unknown>).DocsAPI` appears at lines 30 and 96.

Replace both casts with a module-level global augmentation:
```typescript
interface OnlyOfficeDocEditor {
    destroyEditor: () => void;
}
interface OnlyOfficeDocsAPI {
    DocEditor: new (id: string, config: unknown) => OnlyOfficeDocEditor;
}
declare global {
    interface Window {
        DocsAPI?: OnlyOfficeDocsAPI;
    }
}
```
Then use `window.DocsAPI` directly in both places without casting. The interface documents intentional incompleteness (OO has many more methods, but these are all WikINT uses).

**F-6 — Remove Math.random() from editorId**
Confirmed genuine: `office-viewer.tsx:63` appends `Math.random()` to the editor ID.

The effect cleanup always removes the previous `editorDiv` before a new one is created, so `materialId` alone guarantees uniqueness within the page:
```typescript
const editorId = `onlyoffice-editor-${materialId}`;
```
The random suffix creates a latent leak: if `containerRef.current` is null at append time (race between mount and cleanup), the orphaned div is never cleaned up. Removing the suffix eliminates this path.

**F-7 — Remove dead toolbar markup**
Confirmed genuine: `office-viewer.tsx:193–195` renders an empty `<div>` with a placeholder comment.

Remove the empty `<div className="flex items-center gap-1">` element. Change the parent flex container from `justify-between` to `justify-end` so the fullscreen toggle stays right-aligned without dead space. When U-7 content is added to the left side, restore `justify-between` at that point.

---

## Performance

### Strengths

- **Fully async I/O path.** FastAPI + UvicornWorker + aioboto3 means all DB and MinIO I/O is non-blocking. Workers don't thread-block during file transfers.
- **HEAD handled without MinIO.** The HEAD probe returns from DB metadata only. No S3 call, no object read.
- **JWT verification is in-memory.** Token validation on `serve_file_to_onlyoffice` has zero DB or network cost.
- **`scriptLoadPromise` singleton eliminates repeat loads.** The 3-5 MB `api.js` bundle is loaded once per browser session across all office document navigations.
- **Persistent disk cache volume.** The 30-60 second cold-start cost is paid once per deployment. OO's internal build artifacts survive container restarts.

### Issues

| ID | Severity | Issue |
|----|----------|-------|
| P-1 | **Critical** | **`doc_key` random nonce defeats ONLYOFFICE's server-side cache entirely.** Every config request generates a new key, forcing OO to re-fetch and re-render the document from scratch on every page view. For 30 students opening the same PPTX simultaneously: 30 independent conversion jobs, 30 parallel file fetches, 30 parallel MinIO reads. The API container (512 MB reserved, 4 workers) will OOM under this load. The nonce was introduced as a workaround for a pre-nginx-fix issue that is now resolved. **Fix: change to `f"{material_id}-v{version.version_number}"`** — version increment already handles cache invalidation on new uploads. Gate any dev cache-bust behind `settings.is_dev`. |
| P-2 | **High** | **`read_full_object` loads entire file into API worker memory.** `await response["Body"].read()` buffers the full bytes before the first byte is sent to OO. For a 100 MB file: 100 MB held in one Gunicorn worker's heap. The `stream_object` async context manager already exists in `minio.py` and is unused here. Switch to `StreamingResponse` — peak memory drops from `file_size` to one read buffer (~64 KB). |
| P-3 | **Medium** | **`get_material_with_version` executes 3 DB queries per call** (material SELECT with tags selectinload, version SELECT, attachment COUNT). The file endpoint only needs `file_key`, `file_name`, `file_mime_type`, `file_size`. A lightweight dedicated query eliminates the redundant work from the hot path. |
| P-4 | **Medium** | **Per-request S3 client instantiation.** Both `read_full_object` and `serve_file_to_onlyoffice` create a new `aioboto3` client per request, including TCP setup to MinIO on every call. Moving to a lifespan-managed persistent client with connection pooling eliminates this overhead. |
| P-5 | **Low** | **Inconsistent `proxy_read_timeout` on OO asset paths.** The `/onlyoffice/` location has `proxy_read_timeout 300s`. The `^/(cache|web-apps|…)` regex block inherits Nginx's 60s default. During OO cold start, asset requests via the regex block can time out before OO becomes responsive. |

### Implementation Plans

**P-1 — Fix doc_key random nonce defeating OO cache**
Confirmed genuine: `onlyoffice.py:83` appends `secrets.token_hex(4)` to every `doc_key`, forcing a full conversion on every page view.

Replace with:
```python
doc_key = f"{material_id}-v{version.version_number}"
if settings.is_dev:
    # Dev-only: bust OO's cache without uploading a new version.
    # Remove this when iterating on config changes is no longer needed.
    doc_key += f"-{secrets.token_hex(4)}"
```
Version number is incremented on every new upload, which is the correct and sufficient cache invalidation signal. This is a 3-line change that transforms class-scale behavior from 30 independent conversions to 30 cache hits.

**P-2 — StreamingResponse for file serving**
Confirmed genuine: `onlyoffice.py:163` calls `read_full_object` which buffers the entire file into one worker's heap. `stream_object` (an async context manager) already exists in `minio.py:148`.

Add an async generator and switch to `StreamingResponse`:
```python
from collections.abc import AsyncIterator
from fastapi.responses import StreamingResponse
from app.core.minio import stream_object

async def _iter_file(file_key: str) -> AsyncIterator[bytes]:
    async with stream_object(file_key) as body:
        chunk = await body.read(65536)
        while chunk:
            yield chunk
            chunk = await body.read(65536)

# In serve_file_to_onlyoffice (GET branch):
# Remove Content-Length from streaming response — incompatible with chunked transfer.
stream_headers = {k: v for k, v in headers.items() if k != "Content-Length"}
return StreamingResponse(_iter_file(version.file_key), media_type=mime_type, headers=stream_headers)
```
Peak memory per request drops from `file_size` bytes to one 64 KB read buffer. The async context manager keeps the S3 client alive for the duration of the stream.

**P-3 — Lightweight DB query for file endpoint hot path**
Confirmed genuine: `get_material_with_version` executes 3 queries (Material + tags selectinload, MaterialVersion, attachment COUNT). The file endpoint only needs `file_key`, `file_name`, `file_mime_type`, `file_size`.

Add a dedicated function to `api/app/services/material.py`:
```python
async def get_material_file_info(
    db: AsyncSession, material_id: str | uuid.UUID
) -> MaterialVersion:
    """Single JOIN query returning only the fields needed to serve a file."""
    if isinstance(material_id, str):
        material_id = uuid.UUID(material_id)
    result = await db.execute(
        select(MaterialVersion)
        .join(Material, Material.id == MaterialVersion.material_id)
        .where(
            Material.id == material_id,
            MaterialVersion.version_number == Material.current_version,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise NotFoundError("No file available")
    return version
```
Replace the `get_material_with_version` call in `serve_file_to_onlyoffice` with `get_material_file_info`. Keep `get_material_with_version` in `get_onlyoffice_config` since it needs the full material data for the config response.

**P-4 — Persistent S3 client with connection pooling**
Confirmed genuine: every `get_s3_client()` call (including in `read_full_object` and `stream_object`) creates a new aioboto3 client including TCP setup to MinIO.

In `api/app/core/minio.py`, add a module-level persistent client initialized during FastAPI's lifespan:
```python
_s3: Any = None  # persistent client, set by init_s3_client()

async def init_s3_client() -> None:
    global _s3
    _s3 = await _session.client(
        "s3",
        endpoint_url=f"{'https' if settings.minio_use_ssl else 'http'}://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        region_name="us-east-1",
        config=_s3_config,
    ).__aenter__()

async def close_s3_client() -> None:
    global _s3
    if _s3:
        await _s3.__aexit__(None, None, None)
        _s3 = None
```
Register in `main.py` lifespan: call `init_s3_client()` on startup, `close_s3_client()` on shutdown. Update `stream_object` and the file-serving functions to use `_s3` directly instead of creating a new client. Keep `get_s3_client()` as an async context manager for infrequent write operations (copy, delete, move) to avoid refactoring the full module at once.

**P-5 — Consistent proxy_read_timeout on OO asset block**
Confirmed genuine: the `/onlyoffice/` location has `proxy_read_timeout 300s`; the `^/(cache|web-apps|...)` regex block inherits Nginx's 60s default.

In `nginx.dev.conf.template`, add to the regex asset location block:
```nginx
location ~* ^/(cache|web-apps|sdkjs|sdkjs-plugins|fonts|dictionaries|meta|printfile)/ {
    set $onlyoffice_upstream http://onlyoffice;
    proxy_pass $onlyoffice_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```
Apply the same change to the production nginx config when OO is added there (A-1 plan). This ensures asset requests during OO's 30–60s cold start do not time out before OO becomes responsive.

---

## Cross-Cutting Priority Matrix

| Priority | ID | Dimension | Issue | Effort |
|----------|----|-----------|-------|--------|
| 1 | S-1 | Security | Weak default secret — forged file tokens without user auth | Trivial (`model_validator`) |
| 2 | P-1 | Performance | Random nonce defeats OO cache — class-scale OOM | 1 line |
| 3 | P-2 | Performance | Full file bytes in memory — switch to `StreamingResponse` | Low |
| 4 | S-2/S-3 | Security | Token in URL (→ logs) + unsanitized `Content-Disposition` | Low |
| 5 | F-1 | Frontend | `loading` not reset on `materialId` change | Trivial |
| 6 | S-8 | Security | `get_material_with_version` may bypass directory-level authorization | Audit required |
| 7 | U-1/U-4 | UX | Spinner-only loading + no skeleton for a 2-12s process | Low–Medium |
| 8 | U-2 | UX | Cold start → immediate opaque error, no retry | Medium |
| 9 | A-3 | Architecture | No script-load timeout — OO startup stalls viewer for up to 300s | Low |
| 10 | U-5/F-4 | UX + Frontend | Three opaque error messages, no retry button, no download in error state | Low |
| 11 | A-1/A-2 | Architecture | Production compose gap + hardcoded `http://api:8000` | Low |
| 12 | S-6 | Security | Pin `onlyoffice/documentserver:latest` to a specific version tag | Trivial |
| 13 | U-3 | UX | Mobile experience broken — false print affordance, desktop-scale iframe | Medium |
| 14 | U-8 | UX | Iframe has no accessible name (`title` / `aria-label`) | Trivial |
| 15 | P-3 | Performance | 3 DB queries per file serve — lightweight dedicated query | Low |
| 16 | S-5 | Security | Nginx proxies full OO admin surface — add path allowlist | Low |
| 17 | A-5 | Architecture | Document Community Edition concurrency ceiling (~20 concurrent sessions) | Docs only |

---

## Summary

### What's well-engineered

The integration's core security design is solid: two separate JWT secrets, typed token claims, per-material scoping, config signing, and complete permissions lockdown are all correct. The React/ONLYOFFICE DOM isolation strategy is the right solution to a genuinely hard problem and is implemented cleanly. The network topology (OO on frontend, data tier on backend, API as the only bridge) correctly applies least-privilege. The lazy Nginx upstream avoids a startup ordering dependency that would otherwise block the entire stack. These are non-trivial decisions executed correctly.

### Must fix before enabling OO in production

Three issues must be addressed first:

1. **S-1** — Add a `model_validator` that refuses startup if `ONLYOFFICE_JWT_SECRET` equals the placeholder. Without this, forged file tokens are trivial.
2. **P-1** — Remove the random nonce from `doc_key`. One line change; transforms class-scale behavior from OOM risk to cache hit.
3. **P-2** — Switch `serve_file_to_onlyoffice` to `StreamingResponse` using the existing `stream_object` context manager. Eliminates full-file memory buffering.

Together these three changes are under 20 lines of code.
