# Frontend Upload System

## Overview

The frontend upload system orchestrates the client-side portion of the three upload methods, manages concurrent uploads, tracks processing progress, and integrates with the staging store for PR creation. It is arguably the most complex piece of the frontend.

## Upload Flow (Client Perspective)

```
User drops file(s) / folder(s)
    │
    ▼
collectDroppedItems()
    ├── flat files ──────────────────────────────────────────────┐
    │                                                            │
    └── folders ──→ traverseFolder() → zipScannedFiles()        │
                        │                                        │
                        ▼                                        │
                 POST /api/upload/batch-zip                      │
                        │                                        │
                        ▼ (one entry per extracted file)         │
                 trackExistingUpload()                           │
                 (SSE only — no transfer)            ▼           │
                        │                    File validation     │
                        │                    SHA-256 hash        │
                        │                    CAS check           │
                        │                       │ (CAS miss)     │
                        │                       ▼                │
                        │              POST /api/upload ─────────┘
                        │
                        ├──────────────────────────────────────────
                        ▼
             SSE: upload:events/{key} ← Progress updates
                        │
                        ▼
             Staging Store ← { file_key, size, mime_type }
                        │
                        ▼
             PR Creation Wizard → POST /api/pull-requests
```

## Drop Utilities (`lib/drop-utils.ts`)

Handles drag-and-drop item classification, recursive folder traversal, and client-side zip creation.

### Types

```typescript
interface ScannedFile {
    file: File;
    relativePath: string;  // e.g. "FolderA/sub/file.pdf"
}

interface DroppedItems {
    files: ScannedFile[];  // top-level flat files
    folders: Array<{ entry: FileSystemDirectoryEntry; name: string }>;
}
```

### `collectDroppedItems(items)`

Separates a `DataTransferItemList` into flat files and folder entries **without** deep traversal. Folders are returned as `FileSystemDirectoryEntry` objects for deferred processing — the drawer zips each folder independently and in parallel.

### `traverseFolder(entry)`

Recursively traverses a `FileSystemDirectoryEntry` using `FileSystemDirectoryReader.readEntries()` in a loop (the API returns at most 100 entries per call). Returns a flat `ScannedFile[]` with relative paths rooted at the folder's name. Guards against symlink cycles via a `visited` Set of `fullPath` values; limits depth to 20 levels.

### `zipScannedFiles(files, onProgress?)`

Reads each `ScannedFile`'s `ArrayBuffer` and builds a zip blob using **fflate** with `level: 0` (store-only, no compression). Level 0 is intentional:
- Compression ratio stays at 1:1, so the server-side zip-bomb ratio check trivially passes.
- Avoids CPU-intensive deflation on the client for already-compressed formats (PDF, video, etc.).

The `onProgress` callback covers 0–100%: 0–50% for the file-reading phase, 50–100% for the fflate encoding phase.

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

### `uploadBatchZip(zipBlob, options)`

XHR-based POST to `/api/upload/batch-zip` with the zip blob in a `FormData` field named `file`. Reports upload progress via `onProgress`. Returns a `BatchZipResponse`:

```typescript
interface BatchZipEntry {
    filename: string;
    relative_path: string;
    quarantine_key: string;
    upload_id: string;
    size: number;
    mime_type: string;
}

interface BatchZipResponse {
    files: BatchZipEntry[];
    skipped: number;
    errors: string[];
}
```

### `trackExistingUpload(quarantineKey, options)`

Skips the transfer phase entirely (the file is already in quarantine) and goes straight to SSE. Starts `onProgress` at 80% (consistent with the post-transfer state of a normal upload) and calls `_waitForUploadCompletion`. Used exclusively for files that arrive via the batch-zip path.

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

### Batch-Zip Queue Items

`QueueItem` has two optional fields for files that arrived via the folder zip path:

```typescript
isFromBatchZip?: boolean;   // true → file has no local File object; use trackExistingUpload
folderName?: string;        // display label for the source folder
```

The upload drawer maintains an in-memory `quarantineKeysRef: Map<string, string>` (clientId → quarantine_key). When `runUpload` is called for an item with `isFromBatchZip: true`, it reads the quarantine key from this map and calls `trackExistingUpload()` instead of `uploadFile()`. The map is cleared when the drawer closes.

During the zip-and-upload phase a placeholder `QueueItem` with `isFromBatchZip: true` and `folderName` is shown in the drawer so the user can see progress. Once the server responds with the individual file entries, the placeholder is removed and replaced with one queue item per extracted file.

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
- Calls `collectDroppedItems()` to separate flat files from folder entries
- Passes both `initialFiles` and `initialFolderEntries` to the upload drawer
- The drawer handles flat files via the normal upload path and folders via `processFolderViaZip`

## Upload Drawer (`components/pr/upload-drawer.tsx`)

Side panel showing:
- In-progress uploads with **two distinct progress bars per file**:
  - **Upload bar** (primary/blue): tracks byte transfer progress remapped from 0–80% internal range to 0–100%. Shows MB/s speed and ETA during transfer. Stays at 100% once transfer completes.
  - **Processing bar** (amber): appears once transfer completes (internal progress ≥ 80%). Tracks server-side pipeline stages (scanning → metadata strip → compression → finalizing) using `overall_percent` from SSE events. Displays the current stage name from `processingStatus` and stage counter (N/M).
- Completed uploads with file keys
- Failed uploads with error messages
- Cancel button for individual uploads

### Folder Upload Flow (`processFolderViaZip`)

When a `FileSystemDirectoryEntry` is received (via `initialFolderEntries` prop or an in-drawer drop), the drawer:

1. Adds a placeholder `QueueItem` (`isFromBatchZip: true`, `folderName`) so the folder appears immediately in the drawer with a spinner.
2. Calls `traverseFolder()` to recursively collect all files with relative paths.
3. Calls `zipScannedFiles()` to build a zip blob with fflate (`level: 0`).
4. Calls `uploadBatchZip()` to POST the zip to `/api/upload/batch-zip`.
5. Removes the placeholder item.
6. For each `BatchZipEntry` in the response: creates a new `QueueItem` with `isFromBatchZip: true`, stores `quarantine_key` in `quarantineKeysRef`, and calls `startUpload()`.
7. `runUpload()` for each such item fast-paths to `trackExistingUpload()` (no file transfer).

Multiple folders dropped simultaneously each get their own independent `processFolderViaZip` call and AbortController, running concurrently.

### Per-Role File Limit

```typescript
const MAX_FILES_PER_BATCH_DEFAULT = 50;
const PRIVILEGED_ROLES = new Set(["moderator", "bureau", "vieux"]);

const isPrivileged = PRIVILEGED_ROLES.has(user?.role ?? "");
const maxFilesPerBatch = isPrivileged ? Infinity : MAX_FILES_PER_BATCH_DEFAULT;
```

Privileged users (moderator, bureau, vieux) have no batch file cap. Regular users are limited to 50 files per drop. The limit applies to flat file drops; folder uploads are not capped at the drawer level (the server enforces per-role limits on the `batch-zip` endpoint).

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
