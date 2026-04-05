# Cleanup Workers

## Overview

Three background workers handle resource cleanup. They prevent storage bloat, quota exhaustion, and orphaned S3 objects.

## Worker Reliability Guards

WikINT workers include built-in safeguards to prevent system exhaustion:

- **Disk Space Guard:** Before downloading any file for processing, the worker checks for available space in the temporary directory. If free space is less than **1.5x the file size**, the job is failed and automatically re-queued to prevent node crashes.
- **Orphan Cleanup:** The system periodically checks the `materials/` and `cas/` prefixes against the database to identify files that are no longer referenced. This job can be run in `dry_run` mode for verification.
- **Pull Request Expiration:** Open Pull Requests that have not been updated for **7 days** are automatically marked as `REJECTED` by the cleanup worker. This releases their staged files in `uploads/` for automated S3 cleanup (see Cloudflare R2 Lifecycle Policies).

## Cleanup Uploads (`api/app/workers/cleanup_uploads.py`)

**Schedule:** Periodic (configured via ARQ cron)

Removes uploaded files that are no longer needed based on DB status, and scans quarantine/ for stale objects that have no DB record.

### Logic (Phase 5 — status-based)

1. **Expire stale PRs** — mark `OPEN` PRs older than 7 days as `REJECTED`.
2. **Collect protected keys** — gather `file_key` values from all `OPEN`/`APPROVED` PRs.
3. **Status-based cleanup (3.8)** — query `Upload` table for rows with terminal status (`clean`, `failed`, `malicious`) and `updated_at < 48h ago`. Deletes are batched into chunks of 1,000 keys and incrementally flushed to prevent unbounded memory growth (OOM) and S3 API limit violations, skipping protected keys. This avoids listing millions of S3 objects.
4. **Quarantine scan** — scan `quarantine/` prefix for objects older than 2 hours (these may have no DB row — e.g. pre-row-creation failures) and delete them.
5. **Orphan cleanup** — scan `materials/` and `cas/` prefixes against the DB, removing unreferenced objects.

### Why Status-Based Over S3 Scan

The old approach listed all objects with the `uploads/` prefix and checked their modification time. This requires O(N) S3 API calls proportional to total uploads. The status-based approach queries a single DB table and is O(terminal uploads in window), which is dramatically faster for large deployments.

## Cleanup Orphans (`api/app/workers/cleanup_orphans.py`)

**Schedule:** Periodic (less frequent than upload cleanup)

Identifies and removes S3 objects that have no corresponding database reference.

### Logic
1. **Materials Scan**: List all objects in `materials/` and delete those not found in `MaterialVersion`.
2. **CAS Scan**: List all objects in `cas/` prefix.
   - For each object, extract the CAS ID (HMAC suffix).
   - Check if any `Upload` row has a `sha256` matching this CAS ID.
   - If no reference exists: call `delete_storage_objects` to decrement reference count or delete the S3 object.

### Why This Exists
Edge cases can leave orphaned objects:
- A PR was deleted but its file cleanup job failed
- An upload was completed but the DB row insertion failed
- A race condition between cleanup and PR approval

This worker is the safety net that catches everything the other cleanup mechanisms miss.

## Reconcile Multipart (`api/app/workers/reconcile_multipart.py`)

**Schedule:** Periodic

Identifies and aborts abandoned S3 multipart uploads.

### Logic
1. Call `list_multipart_uploads()` to get all in-progress S3 multipart uploads
2. For each upload:
   - Check the initiation timestamp
   - If older than a threshold (e.g., 24 hours): abort the multipart upload

### Why This Exists
S3 multipart uploads that are initiated but never completed (client crashed, network failure, browser tab closed) consume S3 resources and are billed. Each incomplete part occupies storage until the multipart upload is explicitly aborted.

The TUS protocol and presigned multipart flows both create S3 multipart uploads that may be abandoned. This worker ensures they don't accumulate.

## Worker Settings (`api/app/workers/settings.py`)

Configures the ARQ worker:
- Redis connection
- Job functions (process_upload, cleanup tasks)
- Cron schedules for periodic tasks
- Worker concurrency settings
- Job timeout and retry configuration

## Webhook Dispatch (`api/app/workers/webhook_dispatch.py`)

Sends HMAC-SHA256 signed HTTP POST requests to webhook URLs registered on upload rows.

### Payload
```json
{
  "event": "upload.complete",
  "upload_id": "...",
  "status": "clean",
  "file_key": "uploads/...",
  "sha256": "...",
  "mime_type": "...",
  "size": 12345,
  "timestamp": "2026-04-02T10:00:00+00:00"
}
```

### Retry Strategy (Phase 5 — ARQ exponential backoff)

Each `dispatch_webhook` ARQ job makes a **single delivery attempt**. On transient failure (network error or HTTP 5xx), it re-enqueues itself with `_defer_by` for exponential backoff:

| Attempt | Deferred by |
|---------|-------------|
| 1 → 2   | 30 seconds  |
| 2 → 3   | 2 minutes   |
| 3 (final) | — → DLQ  |

After 3 failed attempts, a `dead_letter_jobs` record is inserted for manual review. Permanent errors (4xx, invalid URL) are not retried.

This design frees the ARQ worker slot between retries rather than blocking it with `asyncio.sleep`.

### Security
The webhook body is signed with `HMAC-SHA256(webhook_secret, body)`. The signature is sent in the `X-WikINT-Signature: sha256=<hex>` header. Recipients should verify this signature before trusting the payload.

Webhook URLs are validated against SSRF rules (HTTPS only, no private/loopback IPs) before any delivery attempt.
