# Cleanup Workers & View Reset Workers

## Overview

Six background workers handle resource cleanup and view-counter maintenance. They prevent storage bloat, quota exhaustion, and orphaned S3 objects, as well as ensure GDPR compliance and accurate popularity metrics.

## Worker Reliability Guards

WikINT workers include built-in safeguards to prevent system exhaustion:

- **Disk Space Guard:** Before downloading any file for processing, the worker checks for available space in the temporary directory. If free space is less than **2.0x the file size**, the job is failed and automatically re-queued to prevent node crashes.
- **Orphan Cleanup:** The system periodically checks the `cas/` prefix against Redis ref counts to identify unreferenced objects. Legacy `materials/` and `uploads/` objects are also cleaned up.
- **Pull Request Expiration:** Open Pull Requests that have not been updated for **7 days** are automatically marked as `REJECTED` by the cleanup worker.
- **GDPR Compliance:** Users who are soft-deleted are automatically purged after a **30-day grace period**.

## View Reset Workers (`api/app/workers/view_reset.py`)

Two cron-driven functions maintain the per-material view counters used by the Home page popularity rankings.

### `reset_daily_views`

**Schedule:** Daily at 00:00 (midnight UTC)

Accumulates each material's `views_today` counter into the 14-day rolling counter `views_14d`, then clears `views_today` back to zero. Only materials with `views_today > 0` are touched, keeping the UPDATE narrow.

**Operation (single atomic SQL statement per row):**
```sql
UPDATE materials
SET
    views_14d        = views_14d + views_today,
    views_today      = 0,
    last_view_reset  = now()
WHERE views_today > 0;
```

The accumulation and reset happen in the **same statement**, so there is no window where data can be lost if the process crashes between the two operations.

### `reset_14d_views`

**Schedule:** 1st and 15th of each month at 01:00 UTC (approximately every 14 days)

Zeroes out `views_14d` for all materials so that the counter genuinely reflects a two-week window rather than accumulating indefinitely. Only materials with `views_14d > 0` are touched.

```sql
UPDATE materials SET views_14d = 0 WHERE views_14d > 0;
```

**Why two separate jobs?** `reset_daily_views` runs every night and keeps the 14d counter fresh; `reset_14d_views` provides the periodic hard reset that bounds the counter to a genuine 14-day window.

---

## GDPR Cleanup (`api/app/workers/gdpr_cleanup.py`)

**Schedule:** Daily at 04:00 (configured via ARQ cron)

Purges soft-deleted users past the 30-day grace period. This process utilizes the `hard_delete_user` service to ensure all associated private data (avatars, uploads, notifications) is securely removed from both the database and S3 storage.

### Logic

1. Query for users where `deleted_at` is older than 30 days.
2. For each user, perform a `hard_delete_user` operation:
   - Delete avatar from S3.
   - Delete orphaned `Upload` records.
   - Delete the user record (cascades to notifications, comments, annotations, etc.).
3. Commit deletion.


## Cleanup Uploads (`api/app/workers/cleanup_uploads.py`)

**Schedule:** Periodic (configured via ARQ cron)

Removes uploaded files that are no longer needed based on DB status, scans quarantine/ for stale objects, and manages CAS reference counting for expired uploads.

### Logic (CAS V2)

1. **Expire stale PRs** — mark `OPEN` PRs older than 7 days as `REJECTED`.
2. **Expire stale pending uploads** — mark `pending` uploads older than 2 hours as `failed`.
3. **Abort stale multipart uploads** — abort S3 multipart uploads older than 24 hours.
4. **Collect protected keys** — gather `file_key` values from all `OPEN`/`APPROVED` PRs.
5. **Status-based cleanup** — query `Upload` table for rows with terminal status (`clean`, `failed`, `malicious`) and `updated_at < 48h ago`:
   - **CAS keys (`cas/`):** Decrement the CAS ref count using the upload's `sha256`. The S3 object is only deleted when ref_count reaches 0.
   - **Legacy keys (`uploads/`, `quarantine/`):** Direct S3 delete.
   - Clean up synthetic staging quota entries from Redis.
6. **Quarantine scan** — scan `quarantine/` prefix for objects older than 2 hours and delete them.
7. **CAS orphan scan** — list `cas/` S3 objects and compare against Redis `upload:cas:*` keys. Objects without a Redis ref entry older than 48h are deleted.
8. **Legacy prefix cleanup** — scan any remaining `materials/` and `uploads/` S3 objects and delete them (V1 migration remnants).
9. **Integrity check** — verify all CAS-backed MaterialVersions have existing S3 objects. Log warnings for any missing objects (manual investigation required).

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
  "file_key": "cas/...",
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
