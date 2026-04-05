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
  "payload": [
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
      "file_key": "uploads/user-id/upload-id/notes.pdf",
      "file_name": "notes.pdf"
    }
  ]
}
```

**Key behaviors:**
1. **File key validation:** For each operation that references a `file_key`, the endpoint verifies:
   - The key starts with `uploads/{user_id}/` (the requesting user's staging area)
   - The file exists in S3
   - The scan result cache in Redis shows `CLEAN`
2. **Summary types extraction:** Collects the unique `op` values into `summary_types` for filtering
3. **Virus scan aggregation:** If all referenced files are clean, PR scan result is `CLEAN`

### `GET /api/pull-requests`

Lists pull requests with filtering and pagination.

**Query parameters:** `status`, `author_id`, `type`, `offset`, `limit`

Returns `PRListItem` objects with author info, vote summary, and comment count.

### `GET /api/pull-requests/{id}`

Returns full PR detail including payload operations, votes, and comments.

### `POST /api/pull-requests/{id}/approve`

**Requires:** Moderator role (moderator, bureau, vieux)

Approves the PR and executes all operations atomically:

1. Load PR with eager-loaded relationships
2. Verify status is `open`
3. Verify virus scan is `clean`
4. Call `apply_pr(db, pr, user_id)` (see [PR Engine](../business-services/pr-engine.md))
5. Set status to `approved`, record `reviewed_by`
6. Commit transaction (triggers post-commit jobs: search indexing, file cleanup)

**Atomicity guarantee:** All operations in the PR payload execute within a single database transaction. If any operation fails, the entire transaction rolls back and no materials/directories are created, edited, or deleted.

### `POST /api/pull-requests/{id}/reject`

**Requires:** Moderator role

Sets status to `rejected` and records `reviewed_by`. No content changes occur.

### `POST /api/pull-requests/{id}/vote`

**Input:** `{ "value": 1 }` (or -1)

Records a vote. Uses the `(pr_id, user_id)` unique constraint — if the user has already voted, the value is updated (upsert).

### `DELETE /api/pull-requests/{id}/vote`

Removes the user's vote.

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

1. User uploads files → files land in `uploads/{user_id}/{upload_id}/...` (already scanned and processed)
2. User creates PR referencing these `uploads/` keys
3. PR is approved → files are **copied** to `materials/...` prefix
4. After commit, a post-commit job **deletes** the `uploads/` copies

The copy-before-commit, delete-after-commit pattern ensures:
- If the transaction fails, the original uploads are preserved
- If the transaction succeeds, staging files are cleaned up asynchronously
