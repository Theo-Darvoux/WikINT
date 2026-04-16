# Pull Request Endpoints (`api/app/routers/pull_requests.py`)

## Overview

Pull requests are the **gatekeeping mechanism** for all content changes. No material can be published, edited, or deleted without going through a PR that is reviewed and approved by a moderator. This is the core workflow that makes WikINT a collaborative platform rather than a simple file store.

## Endpoints

### `POST /api/pull-requests`

Creates a new pull request with a batch of operations.

**Input:**
```json
{
  "title": "Add Linear Algebra notes",
  "description": "Notes from Prof. Martin's lectures",
  "operations": [
    {
      "op": "create_directory",
      "temp_id": "$dir1",
      "name": "Linear Algebra",
      "parent_id": "existing-uuid",
      "type": "folder"
    },
    {
      "op": "create_material",
      "temp_id": "$mat1",
      "title": "Chapter 1 Notes",
      "directory_id": "$dir1",
      "type": "pdf",
      "file_key": "cas/abc123...",
      "file_name": "notes.pdf"
    }
  ]
}
```

**Key behaviors:**
1. **File key validation:** For each operation that references a `file_key`, the endpoint verifies:
   - The key starts with `uploads/{user_id}/` (staging area) or `cas/` (content-addressed storage)
   - The user owns the key (verified via the `uploads` table for `cas/` keys)
   - The file exists in S3
   - The user has a clean `Upload` row for that key
2. **File claiming:** Each `file_key` is claimed atomically via the `pr_file_claims` table (PRIMARY KEY uniqueness enforces exclusivity). If another open PR has already claimed the same file, an `IntegrityError` is returned as a 400 Bad Request.
3. **Summary types extraction:** Collects the unique `op` values into `summary_types` for filtering.
4. **Open PR limit:** Regular users are limited to 5 open PRs. Moderators, `bureau`, and `vieux` are exempt.
5. **Auto-approval:** For users with `BUREAU` or `VIEUX` roles, the PR is automatically approved and executed in the same transaction. The response status is `APPROVED` and `applied_result` is populated immediately.

### `GET /api/pull-requests`

Lists pull requests with filtering and pagination.

**Query parameters:** `status`, `author_id`, `type`, `page`, `limit`

Uses `selectinload` to eagerly load author data — no N+1 queries.

Returns `PullRequestOut` objects with author info and total count in `X-Total-Count` header.

### `GET /api/pull-requests/for-item`

**Query parameters:** `targetType` (`material` | `directory`), `targetId` (UUID string or `"root"`)

Returns open PRs whose payload references the given item.

- **For Materials**: Matches `material_id` or `parent_material_id`.
- **For Directories**: Matches `directory_id`, `parent_id`, or `new_parent_id`.
- **Special Case: Root**: Passing `targetId=root` returns PRs targeting the root directory (where parent/directory IDs are `null`). This includes new materials/directories created in root and items moved into root.

Uses a JSONB `jsonb_array_elements` lateral query on PostgreSQL (covered by the GIN index on `payload`). Falls back to Python-level filtering on SQLite.

### `GET /api/pull-requests/{id}`

Returns full PR detail including payload operations and (if approved) `applied_result`.

Uses `joinedload` for author — single query, no N+1.

### `POST /api/pull-requests/{id}/approve`

**Requires:** Moderator role (moderator, bureau, vieux)

Approves the PR and executes all operations atomically:

1. Verify status is `open`
2. Call `apply_pr(db, pr, user_id)` (see [PR Engine](../business-services/pr-engine.md))
3. Set status to `approved`, record `reviewed_by`
4. Delete `pr_file_claims` rows for this PR (releases file claims)
5. Commit transaction (triggers post-commit jobs: search indexing, file cleanup)

**Atomicity guarantee:** All operations in the PR payload execute within a single database transaction. If any operation fails, the entire transaction rolls back and no materials/directories are created, edited, or deleted.

### `POST /api/pull-requests/{id}/reject`

**Requires:** Moderator role

Sets status to `rejected` and records `reviewed_by`. 
**Rejection Reason:** An optional `reason` (string) can be provided in the request body (`RejectRequest`).
 No content changes occur.

Dispatches `delete_storage_objects` background jobs for any `uploads/` staging files (not `cas/` keys, which are managed by the upload cleanup worker). Deletes `pr_file_claims` rows to release file claims.

### `POST /api/pull-requests/{id}/cancel`

**Requires:** The PR author (anyone else — including moderators who did not author the PR — gets `403 Forbidden`).

Lets an author withdraw their own open contribution. Returns `400 Bad Request` if the PR is not in `OPEN` status.

Behavior:
1. Sets status to `cancelled`.
2. Dispatches `delete_storage_objects` background jobs for any `uploads/` staging files referenced by the payload (CAS keys untouched; the upload cleanup worker decrements ref counts on expiry).
3. Deletes `pr_file_claims` rows for the PR, releasing the underlying file keys so the author can re-stage and resubmit.

No `apply_pr()` runs, no content is created, no notification is sent. Cancelled PRs drop out of the author's open-PR quota and are excluded from `/for-item` results.

### `POST /api/pull-requests/{id}/revert`

**Requires:** Administrator role (`bureau` or `vieux` only — moderators cannot revert).

Reverses all operations from an approved PR within the 7-day grace period. Creates and immediately applies a new "revert" PR linked to the original.

**Pre-checks:**
1. PR status must be `approved`
2. PR type must not be `revert` (reverts cannot be reverted)
3. PR must not already have `reverted_by_pr_id` set
4. `approved_at + 7 days > now` (grace period check)
5. `applied_result` must contain `pre_state` snapshots (legacy PRs approved before this feature are non-revertable)

**Behavior:**
1. Walks the original PR's `applied_result` in **reverse order** and builds inverse operations:
   - `create_*` → `delete_*` (soft-delete)
   - `delete_*` → `undelete_*` (restores soft-deleted rows)
   - `edit_*` → `edit_*` with `pre_state` values (reverts fields to before the PR)
   - `move_item` → `move_item` back to `pre_state.prev_parent_id` / `prev_directory_id`
2. Creates a new `PullRequest` row with `type="revert"`, `status=APPROVED`, `reverts_pr_id=original.id`
3. Executes all reverse operations in a single transaction
4. Sets `original.reverted_by_pr_id = revert.id`
5. Notifies the original author if different from the reverting admin

**Important:** Edit reverts are absolute — the item returns to its pre-PR state regardless of any subsequent edits. This is by design (user-confirmed behavior).

**Response:** Returns the newly created revert `PullRequestOut` (status 201).

### `GET /api/pull-requests/{id}/diff`

Stub endpoint — returns a count of file operations. Not yet implemented.

### `GET /api/pull-requests/{id}/preview`

**Requires:** Author or moderator role.

Returns a presigned URL to preview a file referenced by the PR. Access is restricted to the PR author and moderators (S13).

### `GET /api/pull-requests/{id}/comments`

Lists comments for the PR in chronological order. Uses `joinedload` for author data.

### `POST /api/pull-requests/{id}/comments`

Posts a comment. Sends a reply notification to the parent comment's author if applicable.

**Rate Limit:** 10 requests per minute.

## Operation Types

The PR payload supports 7 operation types:

| Operation | Fields | Description |
|-----------|--------|-------------|
| `create_material` | title, type, directory_id, file_key, file_name, tags, description, metadata, attachments | Creates a new material with version 1 |
| `edit_material` | material_id, title?, type?, description?, tags?, metadata?, file_key?, file_name? | Updates an existing material, optionally adding a new version |
| `delete_material` | material_id | Deletes a material and all its versions |
| `create_directory` | name, parent_id, type, description, tags, metadata | Creates a new directory |
| `edit_directory` | directory_id, name?, type?, description?, tags?, metadata? | Updates directory properties |
| `delete_directory` | directory_id | Deletes a directory (cascade deletes contents) |
| `move_item` | target_type, target_id, new_parent_id | Moves a material or directory to a new parent |

## Temp ID System

Operations within a single PR can reference each other using `$`-prefixed temporary IDs:

```json
[
  { "op": "create_directory", "temp_id": "$d1", "name": "New Folder", ... },
  { "op": "create_material", "directory_id": "$d1", "title": "File", ... }
]
```

The second operation references `$d1`, which will be resolved to the actual UUID of the directory created by the first operation. This is handled by the PR engine's topological sort (see [PR Engine](../business-services/pr-engine.md)).

## File Lifecycle During PR

1. User uploads files → files land in `uploads/{user_id}/{upload_id}/...` (already scanned and processed), or directly in `cas/{hmac}` for CAS V2
2. User creates PR referencing these keys → `pr_file_claims` rows are inserted to claim the files
3. **On approval:**
   - CAS V2 (`cas/`): files stay in place; ref count incremented
   - Legacy V1 (`uploads/`): files copied to `materials/...` prefix; originals deleted post-commit
   - `pr_file_claims` rows deleted
4. **On rejection:**
   - `uploads/` staging files deleted via background worker
   - `pr_file_claims` rows deleted
5. **On cancellation (by author):**
   - `uploads/` staging files deleted via background worker
   - `pr_file_claims` rows deleted — files become available for a fresh PR

## Response Shape

`PullRequestOut` includes:
- `payload`: Original operations as submitted (never mutated)
- `applied_result`: Enriched operations populated after approval (each with `result_id`, `result_browse_path`, and `pre_state` for edit/move ops). `null` for open, rejected, and cancelled PRs.
- `approved_at`: Timestamp when the PR was materialized (anchors the 7-day revert grace window)
- `reverts_pr_id`: If this is a revert PR, points to the original PR it undoes
- `reverted_by_pr_id`: If this PR has been reverted, points to the revert PR
- `revert_grace_expires_at`: Computed: `approved_at + 7 days`. `null` if not approved.
- `can_revert`: Computed boolean: `true` when the PR is approved, not a revert, not already reverted, within the grace window, and has pre_state snapshots.

## PR Status Values

| Status | Meaning |
|--------|---------|
| `open` | Awaiting moderator review |
| `approved` | Merged; content materialized (`applied_result` populated) |
| `rejected` | Moderator declined; `rejection_reason` populated |
| `cancelled` | Author withdrew their own open PR before review |

## PR Types

| Type | Meaning |
|------|---------|
| `batch` | Standard contribution (default) |
| `revert` | Auto-generated PR that undoes another PR's operations |

## Soft-Delete & Revert System

### Soft-Delete

Materials, directories, and material versions use soft-delete (`deleted_at` column). When a delete operation runs:
1. `deleted_at` is set to `now()` on the item and its subtree (versions, attachment dirs, child materials)
2. The item is removed from MeiliSearch immediately
3. CAS ref counts are **not** decremented (the file data is preserved during the grace period)
4. A background worker hard-deletes rows where `deleted_at < now - 7 days`, decrements CAS refs, and fires S3 deletes

A global SQLAlchemy `do_orm_execute` event filter automatically excludes soft-deleted rows from all SELECT queries. Opt out with `.execution_options(include_deleted=True)`.

### Revert Grace Period

Approved PRs can be reverted by admins within 7 days of `approved_at`. After that, the operations are permanent. Legacy PRs approved before the revert feature was deployed lack `pre_state` snapshots and cannot be reverted (enforced at the service layer with a clear error message).
