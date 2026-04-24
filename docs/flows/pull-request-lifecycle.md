# Pull Request Lifecycle Flow

## Overview

Every content change in WikINT — creating materials, editing metadata, deleting files, reorganizing directories — goes through a pull request. This document traces the complete lifecycle from staging operations in the browser to content materialization after approval.

## Phase 1: Operation Staging (Client)

**Location:** `web/src/lib/staging-store.ts`, browse pages, PR components

### Step 1.1: User Initiates a Change

The user performs one or more actions in the browse UI:
- Uploads a file → `create_material` operation
- Creates a folder → `create_directory` operation
- Edits material metadata → `edit_material` operation
- Deletes a material → `delete_material` operation
- Moves an item → `move_item` operation

### Step 1.2: Operations Accumulate in Staging Store

Each action appends an operation to the Zustand staging store, which persists to `localStorage`:

```json
{
  "op": "create_material",
  "temp_id": "$mat1",
  "title": "Lecture Notes",
  "directory_id": "existing-uuid-or-$ref",
  "type": "pdf",
  "file_key": "cas/abc123...",
  "file_name": "notes.pdf",
  "file_size": 12345,
  "file_mime_type": "application/pdf",
  "stagedAt": 1711756800000
}
```

**Key behaviors:**
- Operations can reference each other via `$`-prefixed `temp_id`s (e.g., create a directory, then place a material inside it)
- Each operation records a `stagedAt` timestamp for expiry tracking
- The staging FAB shows the count of pending operations

### Step 1.3: Expiry Management

Uploaded files have a 24-hour server-side TTL. The staging store provides:
- `isExpired(op)` — Has the referenced upload expired?
- `isExpiringSoon(op)` — Less than 2 hours remaining?
- `purgeExpired()` — Remove all expired operations

The UI disables PR submission if any referenced uploads have expired.

## Phase 2: PR Creation

**Location:** `web/src/app/pull-requests/new/page.tsx` → `api/app/routers/pull_requests.py`

### Step 2.1: User Submits PR

1. User opens the PR creation wizard
2. Provides a title and optional description
3. Reviews the staged operations
4. Clicks "Submit"

### Step 2.2: Server Validation (`POST /api/pull-requests`)

1. **Operation count check:** Regular users ≤ 50 ops; privileged users ≤ 500 ops
2. **Open PR limit:** Regular users capped at 5 open PRs (moderators, bureau, vieux exempt)
3. **File key ownership check:** Every `file_key` must start with `uploads/{requesting_user_id}/` or `cas/`. Ownership of `cas/` keys is verified via the `uploads` table.
4. **File existence check:** Every referenced file must exist in S3
5. **Scan result check:** The user must have a clean `Upload` row for every file
6. **Summary types extraction:** Collect unique `op` values

### Step 2.3: PR Record + File Claims

(same as before)

### Step 2.4: Auto-Approval (Privileged Users)

If the author has a staff role (`MODERATOR`, `BUREAU`, or `VIEUX`) and has enabled auto-approval:
1. The PR status is set directly to `APPROVED`.
2. `apply_pr()` is executed immediately in the same transaction.
3. `pr_file_claims` are released.
4. The response includes the `applied_result`, allowing the UI to navigate to the result immediately.

### Step 2.5: Client Cleanup

On successful PR creation, the staging store clears all submitted operations.

## Phase 3: Review Period

### Step 3.1: PR Listing

PRs appear on the `/pull-requests` page with status filtering (open, approved, rejected, cancelled). Each card shows:
- Title, description, author
- Operation summary (counts by type)

### Step 3.2: Discussion

Users and moderators can leave comments on the PR:
- Threaded comments with `parent_comment_id` for replies
- Comments create notifications for the PR author and other participants

### Step 3.3: PR Detail View

The PR detail page (`/pull-requests/{id}`) renders:
- Full operation list with visual diff (what will be created/edited/deleted)
- **Enriched move/delete summaries:** `move_item`, `delete_material`, and `delete_directory` operations resolve and display the item's name and path asynchronously (via `/materials/{id}` and `/directories/{id}/path`). Move operations show a from → to path indicator in the subtitle row.
- **File previews for uploaded materials:**
  - **Open PRs:** Create/edit ops with a staged upload link to `/pull-requests/{prId}/preview/{opIndex}` (fake previewer). Move/delete ops targeting existing materials show an inline **Preview** button that opens a `PreviewDialog`.
  - **Approved PRs:** All preview buttons for created, edited, or moved items lead directly to the "real place" in the library (e.g., `/browse/path/to/material`) instead of using limited previewers. For deleted items, the preview is disabled as the content is removed.
- Comment thread
- Approve/Reject buttons (moderator-only)

**Browse preview (`?preview_pr={id}`):** For open PRs, items affected by operations are displayed with colored badges (green "Edited", red "Deleting", amber "Moving") in the browse UI. For approved PRs, the "View in library" button leads directly to the live content without the preview query parameter.

## Phase 4: Approval & Content Materialization

**Location:** `api/app/routers/pull_requests.py` → `api/app/services/pr.py:apply_pr()`

### Step 4.1: Moderator Approves

`POST /api/pull-requests/{id}/approve` (requires `moderator`, `bureau`, or `vieux` role)

Pre-checks:
- PR status must be `OPEN`

### Step 4.2: Topological Sort

`topo_sort_operations(operations)` orders the operation list so that:
- Any operation defining a `temp_id` executes before operations referencing that `temp_id`
- Uses Kahn's algorithm with stable index-based ordering
- Raises `BadRequestError` on cyclic dependencies

The sort operates on a copy of `pr.payload` — the original is never modified.

### Step 4.3: Sequential Execution

Each operation executes within a **single database transaction** via the dispatch table:

```python
_EXECUTORS = {
    "create_material":   _exec_create_material,
    "edit_material":     _exec_edit_material,
    "delete_material":   _exec_delete_material,
    "create_directory":  _exec_create_directory,
    "edit_directory":    _exec_edit_directory,
    "delete_directory":  _exec_delete_directory,
    "move_item":         _exec_move_item,
}
```

For each operation:
1. Resolve any `$`-prefixed references from the `id_map`
2. Execute the operation
3. Register the result UUID in `id_map` for downstream references
4. Build an enriched record (`result_id`, `result_browse_path`) in `result_ops`

### Step 4.4: create_material Execution Detail

The most complex executor:

1. Get or create tags
2. Generate a unique slug within the target directory (`SELECT ... FOR UPDATE` to prevent races; regex post-filter to avoid false prefix collisions)
3. Create `Material` row
4. If `file_key` is present:
   - **CAS V2 (`cas/`):** no S3 copy needed; size and MIME from payload
   - **Legacy V1 (`uploads/`):** copy file to `materials/` prefix; schedule delete of staging copy
   - Create `MaterialVersion` row (version 1, scan result `CLEAN`)
5. If `attachments` are present: create a system directory and child materials
6. Schedule search index job

### Step 4.5: edit_material Execution Detail

1. Load existing material with tags
2. Update fields (title, type, description, tags, metadata)
3. If `file_key` is present: create a new `MaterialVersion` (version N+1)
4. Slug is regenerated on title change (unique within directory)

### Step 4.6: move_item Execution Detail

For directories:
- Rejects self-moves and circular ancestry (walks up the parent chain)
- Updates `parent_id`

For materials:
- Updates `directory_id`
- Regenerates slug for uniqueness in the new location

### Step 4.7: Post-Execution

After all operations succeed:
- `pr.applied_result` is set to the enriched operation list (each op annotated with `result_id` and `result_browse_path`)
- `pr_file_claims` rows for this PR are deleted (files now live in permanent locations)
- Status set to `APPROVED`, `reviewed_by` recorded

### Step 4.8: Transaction Commit

All operations succeed → single `COMMIT`.

If any operation fails → full `ROLLBACK`. No materials, directories, or versions are created. Upload files remain in `uploads/` for retry. File claims remain in `pr_file_claims` (PR stays `OPEN`).

### Step 4.9: Post-Commit Jobs

After successful commit, jobs are dispatched via ARQ:

| Job | Purpose |
|-----|---------|
| `index_material` | Add/update material in MeiliSearch |
| `index_directory` | Add/update directory in MeiliSearch |
| `delete_indexed_item` | Remove from MeiliSearch (for deletes). Recursive for parent items. |
| `delete_storage_objects` | Delete `uploads/` staging files (legacy V1) |

**Subtree reindex on rename/move:** When a directory is renamed (name changed) or moved (`move_item`), `_enqueue_reindex_directory_recursive` walks the entire descendant subtree via a recursive CTE and enqueues `index_directory` for every descendant directory and `index_material` for every material within those directories. This ensures `ancestor_path` and `browse_path` in Meilisearch stay consistent after structural changes.

**Deduplication:** Each `(kind, id)` pair is tracked in `db.info["post_commit_job_keys"]` (a `set`) to prevent duplicate enqueues within a single PR merge.

These are fire-and-forget. If a post-commit job fails, the cleanup worker catches it later.

## Phase 5: Post-Approval State

### Final Data State

```
DB:
  pull_requests row → status=APPROVED, applied_result enriched with result_id + result_browse_path
  pull_requests row → payload unchanged (original intent preserved)
  materials rows → created/edited/deleted per operations
  material_versions rows → new versions with file_key under cas/ or materials/ prefix
  directories rows → created/edited/deleted per operations
  pr_file_claims rows → deleted (claims released)

S3:
  cas/{hmac} → permanent (CAS V2, ref-counted)
  materials/{user_id}/{upload_id}/{filename} → permanent (legacy V1)
  uploads/{user_id}/{upload_id}/{filename} → DELETED post-commit (legacy V1 only)

MeiliSearch:
  New/updated materials and directories indexed for full-text search
```

### Post-Approval Navigation

`pr.applied_result` contains `result_browse_path` for each operation, allowing the UI to link directly to the created/edited items from the PR detail page.

### Step 4.0: Direct Submission (Auto-approval)

Privileged users (`MODERATOR`, `BUREAU`, `VIEUX`) can skip the review period by selecting "Direct Submit" in the UI. This triggers a `POST /api/pull-requests/submit-direct` call, which:
1. Atomically creates the PR with status `APPROVED`.
2. Immediately triggers `apply_pr()`.
3. Returns the enriched `applied_result` in the response, allowing the UI to navigate to the new content instantly.

#### Client-Side Immediate Refresh

After a direct submission succeeds (`result.status === "approved"`), all submission entry points call `triggerBrowseRefresh()` from `useBrowseRefreshStore` (in `web/src/lib/stores.ts`). This increments a `refreshCount` counter.

The browse page (`web/src/app/browse/[[...path]]/page.tsx`) subscribes to `refreshCount` as a `useEffect` dependency. When it changes, the page:
1. Deletes the stale cache entry for the current path from the module-level `browseCache` Map.
2. Re-fetches the directory listing from the API immediately.

This replaces the previous `router.refresh()` approach, which only re-ran server-component fetches and did not re-trigger the browse page's client-side `fetchData` when the URL path was unchanged.


---

### Step 4.10: Rejection with Reason

When a moderator rejects a PR, they can provide a `rejection_reason` (string). This is stored in the DB and shown to the author, helping them understand why their contribution was not accepted.

### Step 4.11: Author-Initiated Cancellation

At any point while a PR is still `OPEN`, its author can withdraw it via `POST /api/pull-requests/{id}/cancel`. The endpoint is author-only (`403` for any other caller) and rejects non-open PRs with `400`.

On cancel the server:
1. Sets `status = CANCELLED`.
2. Schedules `delete_storage_objects` for any `uploads/` staging files referenced by the PR payload (legacy V1). CAS keys are left alone — ref decrements happen when the corresponding `uploads` row expires.
3. Deletes all `pr_file_claims` rows for the PR, freeing those file keys so the author can re-stage and submit again.

No `apply_pr()` is run; no content is materialized; no moderator notification is sent (the author is the actor). Cancelled PRs remain queryable via `/pull-requests?status=cancelled` for auditing but are excluded from the open-PR quota and from `for-item` lookups (which filter on `OPEN`).

## Phase 6: Revert (Admin Only)

### Step 6.1: Revert Eligibility

A PR can be reverted when:
- Status is `APPROVED`
- PR type is `batch` (not `revert` — **reverts cannot be reverted**)
- No existing `reverted_by_pr_id` (not already reverted)
- `now < approved_at + 7 days` (within grace period)
- `applied_result` contains `pre_state` snapshots (post-deployment PRs only)
- The requesting user has `BUREAU` or `VIEUX` role (moderators cannot revert)

### Step 6.2: Reverse Operation Generation

`revert_pr()` walks `applied_result` in **reverse order** and generates inverse ops:

| Original Op | Reverse Op |
|-------------|------------|
| `create_material` | `delete_material` (soft-delete) |
| `create_directory` | `delete_directory` (soft-delete subtree) |
| `edit_material` | `edit_material` with `pre_state` values + drop added versions |
| `edit_directory` | `edit_directory` with `pre_state` values |
| `delete_material` | `undelete_material` (clear `deleted_at`) |
| `delete_directory` | `undelete_directory` (recursive clear `deleted_at`) |
| `move_item` | `move_item` back to `pre_state.prev_parent_id` |

### Step 6.3: Revert PR Creation & Execution

1. A new `PullRequest` row is created with `type="revert"`, `status=APPROVED`, `reverts_pr_id=original.id`
2. All reverse operations are executed in a single transaction (using revert-specific dispatch table)
3. `original.reverted_by_pr_id` is set to the revert PR's id
4. Post-commit jobs enqueued (search reindex for restored items, deindex for deleted items)
5. The original PR author is notified (if different from the admin)

### Step 6.4: UI

- Approved PRs show a "Revert contribution" button (admin only, within grace period)
- Grace countdown chip: "Revertable for 4d 12h"
- Double confirmation dialog: checkbox acknowledgement + type "REVERT" to confirm
- Reverted PRs show an amber "Reverted" banner with link to the revert PR
- Revert PRs show a blue "Revert" banner with link to the original
- PR list cards show "Reverted" / "Revert" badges

### Soft-Delete Mechanism

Delete operations use soft-delete (`deleted_at` timestamp) instead of hard-delete:
- All read queries automatically filter `deleted_at IS NULL` via a global SQLAlchemy `do_orm_execute` event
- Opt out with `.execution_options(include_deleted=True)` for revert/cleanup operations
- Background worker hard-deletes rows where `deleted_at < now - 7 days` and decrements CAS refs
- Slug uniqueness constraints are partial indexes filtered on `deleted_at IS NULL`

## Error Scenarios

| Scenario | Behavior |
|----------|----------|
| Transaction rollback during approval | All DB changes rolled back; uploads preserved; PR remains `OPEN`; file claims preserved |
| Post-commit job failure | Cleanup worker catches orphaned files; search re-indexes on next change |
| Duplicate slug collision | `SELECT ... FOR UPDATE` + regex post-filter + suffix generation prevents races and false conflicts |
| Circular directory move | Ancestry walk detects cycles; raises `BadRequestError` |
| Expired upload files | PR submission blocked client-side; server validates file existence |
| Duplicate file claim | DB `IntegrityError` on `pr_file_claims.file_key` PRIMARY KEY → 400 Bad Request |
| Revert of legacy PR | 400 "missing pre_state snapshot" — PRs approved before deployment cannot be reverted |
| Revert grace expired | 400 "grace period expired" — only within 7 days of `approved_at` |
| Revert of a revert | 400 "revert contributions cannot be reverted" — terminal by design |
| Revert of already-reverted PR | 400 "already reverted" — `reverted_by_pr_id` is set |
