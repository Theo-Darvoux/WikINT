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
  "file_key": "uploads/{user_id}/{upload_id}/notes.pdf",
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

1. **File key ownership check:** Every `file_key` in the payload must start with `uploads/{requesting_user_id}/`
2. **File existence check:** Every referenced file must exist in S3
3. **Virus scan check:** Redis `upload:scanned:{file_key}` must be `"CLEAN"` for every file
4. **Summary types extraction:** Collect unique `op` values (e.g., `["create_material", "create_directory"]`)

### Step 2.3: PR Record Creation

```
DB: pull_requests row
  id: uuid
  title: "Add Linear Algebra notes"
  description: "Notes from Prof. Martin's lectures"
  author_id: user_uuid
  status: OPEN
  payload: [ {op1}, {op2}, ... ]  (JSONB)
  summary_types: ["create_material", "create_directory"]
  virus_scan_result: CLEAN
  created_at: now()
```

### Step 2.4: Client Cleanup

On successful PR creation, the staging store clears all submitted operations.

## Phase 3: Review Period

### Step 3.1: PR Listing

PRs appear on the `/pull-requests` page with status filtering (open, approved, rejected). Each card shows:
- Title, description, author
- Operation summary (counts by type)
- Vote tally (upvotes - downvotes)
- Comment count

### Step 3.2: Community Voting

Any authenticated user can vote:
- `POST /api/pull-requests/{id}/vote` with `{ "value": 1 }` or `{ "value": -1 }`
- Uses a `(pr_id, user_id)` unique constraint — upsert semantics
- Votes are advisory; they don't trigger auto-approval

### Step 3.3: Discussion

Users and moderators can leave comments on the PR:
- Threaded comments with `parent_comment_id` for replies
- Comments create notifications for the PR author and other participants

### Step 3.4: PR Detail View

The PR detail page (`/pull-requests/{id}`) renders:
- Full operation list with visual diff (what will be created/edited/deleted)
- File previews for uploaded materials
- Vote buttons and current tally
- Comment thread
- Approve/Reject buttons (moderator-only)

## Phase 4: Approval & Content Materialization

**Location:** `api/app/routers/pull_requests.py` → `api/app/services/pr.py:apply_pr()`

### Step 4.1: Moderator Approves

`POST /api/pull-requests/{id}/approve` (requires `moderator`, `bureau`, or `vieux` role)

Pre-checks:
- PR status must be `OPEN`
- Virus scan result must be `CLEAN`

### Step 4.2: Topological Sort

`topo_sort_operations(operations)` orders the operation list so that:
- Any operation defining a `temp_id` executes before operations referencing that `temp_id`
- Uses Kahn's algorithm with stable index-based ordering
- Raises `BadRequestError` on cyclic dependencies

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
4. Enrich the operation with `result_id` and `result_browse_path`

### Step 4.4: create_material Execution Detail

The most complex executor:

1. Get or create tags
2. Generate a unique slug within the target directory (`SELECT ... FOR UPDATE` to prevent races)
3. Create `Material` row
4. If `file_key` is present:
   - Read actual file size and MIME type from S3 (`get_object_info`)
   - Copy file: `uploads/... → materials/...`
   - Schedule post-commit delete of the `uploads/` copy
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

### Step 4.7: Transaction Commit

All operations succeed → single `COMMIT`.

If any operation fails → full `ROLLBACK`. No materials, directories, or versions are created. Upload files remain in `uploads/` for retry.

### Step 4.8: Post-Commit Jobs

After successful commit, jobs are dispatched via ARQ:

| Job | Purpose |
|-----|---------|
| `index_material` | Add/update material in MeiliSearch |
| `index_directory` | Add/update directory in MeiliSearch |
| `delete_indexed_item` | Remove from MeiliSearch (for deletes) |
| `delete_storage_objects` | Delete `uploads/` staging files |

These are fire-and-forget. If a post-commit job fails, the cleanup worker catches it later.

## Phase 5: Post-Approval State

### Final Data State

```
DB:
  pull_requests row → status=APPROVED, payload enriched with result_id + result_browse_path
  materials rows → created/edited/deleted per operations
  material_versions rows → new versions with file_key under materials/ prefix
  directories rows → created/edited/deleted per operations

S3:
  materials/{user_id}/{upload_id}/{filename} → permanent location
  uploads/{user_id}/{upload_id}/{filename} → DELETED (post-commit)

MeiliSearch:
  New/updated materials and directories indexed for full-text search
```

### Post-Approval Navigation

The PR payload is enriched with `result_browse_path` for each operation, allowing the UI to link directly to the created/edited items from the PR detail page.

## Rejection Flow

`POST /api/pull-requests/{id}/reject` (moderator-only):
- Sets status to `REJECTED`
- Records `reviewed_by` and timestamp
- **No content changes occur**
- Referenced `uploads/` files will be cleaned up by the 24-hour cleanup worker

## Error Recovery

| Scenario | Behavior |
|----------|----------|
| Transaction rollback during approval | All DB changes rolled back; uploads preserved; PR remains `OPEN` |
| Post-commit job failure | Cleanup worker catches orphaned files; search re-indexes on next change |
| Duplicate slug collision | `SELECT ... FOR UPDATE` + suffix generation prevents races |
| Circular directory move | Ancestry walk detects cycles; raises `BadRequestError` |
| Expired upload files | PR submission blocked client-side; server validates file existence |
| Idempotent retry | Operations with existing `result_id` are skipped on re-application |
