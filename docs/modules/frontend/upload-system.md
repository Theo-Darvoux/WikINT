# Frontend Upload System

## Overview

The frontend upload system orchestrates the client-side portion of the three upload methods, manages concurrent uploads, tracks processing progress, and integrates with the staging store for PR creation. It is arguably the most complex piece of the frontend.

## Upload Flow (Client Perspective)

```
User drops file → File validation → SHA-256 hash → CAS check
    │                                                    │
    │ (CAS miss)                              (CAS hit: skip upload)
    ▼                                                    │
POST /api/upload ──────────────────────────────────────── │
    │                                                    │
    ▼                                                    │
SSE: upload:events:{key} ← Progress updates              │
    │                                                    │
    ▼                                                    ▼
Staging Store ← { file_key, size, mime_type }
    │
    ▼
PR Creation Wizard → POST /api/pull-requests
```

## Upload Client (`lib/upload-client.ts`)

### `uploadFile(file, options)`

The main upload function:

1. **Client-side validation:**
   - Check file extension against allowed list
   - Check file size against per-type limits
   - Compute SHA-256 hash using Web Crypto API

2. **CAS deduplication check:**
   - `POST /api/upload/check-exists` with the SHA-256
   - If the file already exists as a clean upload: return the existing file_key immediately (zero transfer)

3. **Upload the file:**
   - `POST /api/upload` with the file as `multipart/form-data`
   - Include `X-Upload-ID` header for idempotency
   - Track upload progress via XHR `onprogress` events

4. **Track processing:**
   - Open SSE connection to `GET /api/upload/events/{quarantine_key}?token=<jwt>`
   - Parse progress events and call `onStatusUpdate` callback
   - Wait for terminal status (clean, malicious, failed)

5. **Return result:**
   - On `clean`: Return `UploadResult` with `file_key`, `size`, `original_size`, `content_encoding`, `mime_type`
   - On `malicious`/`failed`: Throw error with detail message

### `logicalFileSize(result)`

Helper that returns the size the user will see when downloading the file:

- For **gzip-encoded objects** (`content_encoding === "gzip"` — text files, SVG): S3 serves with `Content-Encoding: gzip` and browsers decompress transparently, so the download size equals `original_size`, not the smaller stored bytes.
- For **all other objects** (video, audio, PDF, images, office): returns `size` (the stored/downloaded size).

This value is what gets stored as `file_size` in the PR payload and ultimately in `material_versions.file_size`.

### Options
```typescript
interface UploadOptions {
    onProgress?: (percent: number) => void;
    onStatusUpdate?: (message: string) => void;
    signal?: AbortSignal;
}
```

### SSE Total Timeout (Audit Review Fix)

The `_waitForUploadCompletion` function enforces a 5-minute hard deadline (`SSE_TOTAL_TIMEOUT = 5 * 60 * 1000`). If SSE processing exceeds this deadline, the client falls back to a single HTTP poll before throwing a timeout error. This prevents indefinite hangs if the SSE connection silently drops.

### Presigned Multipart Abort Cleanup (Audit Review Fix)

The presigned multipart upload loop is wrapped in a try/catch. On failure (network error, abort, etc.), the client sends a best-effort `DELETE /upload/presigned-multipart/{upload_id}` to clean up the server-side S3 multipart upload and quota reservation, preventing orphaned partial uploads.

### Progress Guarantee (Audit Review Fix)

`onProgress(100)` is explicitly called after `_waitForUploadCompletion` returns successfully — both on the normal upload path and the CAS deduplication fast-path. This ensures the progress bar always reaches 100% before the upload resolves.

## Upload Hook (`hooks/use-upload.ts`)

React hook wrapping `uploadFile` with state management:

```typescript
const { uploading, progress, error, fileKey, detail, upload, cancel, reset } = useUpload();
```

- `upload(file)` — Starts upload, returns `UploadResult | null`
- `cancel(uploadId?)` — Aborts in-progress upload, optionally cleans up server-side
- `reset()` — Clears upload state

The hook manages an `AbortController` ref and passes its signal to `uploadFile` to explicitly halt the underlying fetch/XHR layer when a new upload starts or cancellation is requested, preventing ghost network connections and wasted bandwidth.

The `cancel` callback uses `state.clientId` (from React state) to identify the active upload queue item. A previous version incorrectly referenced an undefined `clientIdRef` variable, which caused a `ReferenceError` at runtime when cancelling uploads.

## Upload Queue (`lib/upload-queue.ts`)

For batch uploads (e.g., drag-and-drop multiple files):

- Manages a queue of pending uploads
- Limits concurrent uploads (configurable)
- Provides aggregate progress across all files
- Isolates errors — one failed upload doesn't cancel others
- Supports retry for transient failures
- **Rehydration (Audit Review Fix):** On page reload, the `onRehydrateStorage` handler recovers stale 'uploading' items — TUS uploads are set to 'paused' (resumable), non-TUS uploads are set to 'error' with a descriptive message

## Staging Store Integration

After a successful upload, the file_key is added to a staged operation in the Zustand store:

```typescript
stagingStore.addOperation({
    op: "create_material",
    title: file.name,
    type: detectMaterialType(file),
    file_key: result.file_key,
    file_name: file.name,
    file_size: logicalFileSize(result),
    file_mime_type: result.mime_type,
    directory_id: currentDirectoryId,
});
```

The staging store persists to `localStorage`, so staged operations survive page refreshes. Each operation records a `stagedAt` timestamp for expiry tracking.

## Expiry Management

Uploaded files have a 24-hour server-side TTL. The staging store provides:

- `isExpired(staged)` — Has the upload expired?
- `isExpiringSoon(staged)` — Less than 2 hours remaining?
- `purgeExpired()` — Remove all expired operations

The UI shows warnings for expiring uploads and disables submission of PRs with expired files.

## Crypto Utils (`lib/crypto-utils.ts`)

Client-side SHA-256 hashing for CAS deduplication:

```typescript
async function sha256(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
```

Uses the Web Crypto API (`crypto.subtle.digest`) which is:
- Available in all modern browsers
- Hardware-accelerated on many platforms
- Non-blocking (returns a Promise)

## File Utils (`lib/file-utils.ts`)

Client-side file validation utilities:
- Extension whitelist matching the server's `ALLOWED_EXTENSIONS`
- MIME type to material type mapping
- File size formatting (bytes → human-readable)
- Icon selection based on file type
- Filename sanitization

## Global Drop Zone (`components/pr/global-drop-zone.tsx`)

A top-level component that captures drag-and-drop events anywhere on the page:
- Shows a visual overlay when files are dragged over the window
- Validates dropped files against the allowed types
- Enqueues uploads via the upload queue
- Adds operations to the staging store on completion

## Upload Drawer (`components/pr/upload-drawer.tsx`)

Side panel showing:
- In-progress uploads with **two distinct progress bars per file**:
  - **Upload bar** (primary/blue): tracks byte transfer progress remapped from 0–80% internal range to 0–100%. Shows MB/s speed and ETA during transfer. Stays at 100% once transfer completes.
  - **Processing bar** (amber): appears once transfer completes (internal progress ≥ 80%). Tracks server-side pipeline stages (scanning → metadata strip → compression → finalizing) using `overall_percent` from SSE events. Displays the current stage name from `processingStatus` and stage counter (N/M).
- Completed uploads with file keys
- Failed uploads with error messages
- Cancel button for individual uploads

## Staging FAB (`components/pr/staging-fab.tsx`)

Floating action button that:
- Shows the count of staged operations
- Pulses when new operations are added
- Opens the review drawer on click
- Shows expiry warnings

## PR File Upload (`components/pr/pr-file-upload.tsx`)

Upload component within the PR creation wizard:
- File picker with drag-and-drop
- **Two-phase progress display**: upload bar (primary) for transfer, amber processing bar for server-side stages with stage name and N/M counter
- File preview after upload
- Integration with the staging store

## File Preview (`components/pr/file-preview.tsx`)

Renders a preview of an uploaded file:
- Images: Thumbnail
- PDFs: First page thumbnail
- Other types: Icon + file info

## Resumption Support (TUS 1.0.0)

For large files, the frontend uses the **TUS 1.0.0** resumable upload protocol. This ensures that network interruptions or browser crashes do not force the user to restart a 100+ MiB upload.

- **Storage:** The `tusUrl` (returned during the initial `POST` to `/api/tus/`) is stored in the browser's `localStorage` indexed by the file's unique signature (name, size, and timestamp).
- **Resume Flow:** When a file is dropped that matches an entry in `localStorage`, the client first performs a `HEAD` request to the `tusUrl` to retrieve the current `Upload-Offset`. It then resumes the upload from that byte offset.
- **Persistence:** The server-side TUS session state in Redis has a **24-hour TTL**. If a user returns after 24 hours, the `HEAD` request will return 404, and the client will automatically purge the local entry and start a fresh upload.

## SSE Client (`lib/sse-client.ts`)

Manages the EventSource connection for real-time progress:
- Constructs URL with JWT token as query parameter (EventSource can't set headers)
- Uses a BroadcastChannel with a jittered timeout (200ms base + 300ms random variance) for leader election. This prevents a split-brain scenario where multiple tabs open simultaneously and exhaust backend connection limits.
- Parses JSON event data
- Dispatches typed events to callbacks
- Handles connection errors with automatic reconnection and HTTP polling fallback
- Implements keepalive timeout detection
- Closes connection on terminal status
