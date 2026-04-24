# PR Engine (`api/app/services/pr.py`)

## Purpose

The PR engine is the most complex business logic module in the codebase. It takes a pull request's payload (an array of operation dicts) and atomically executes all operations within a single database transaction. It handles inter-operation dependencies, slug uniqueness, CAS reference counting, search index updates, and post-approval enrichment.

## Entry Point: `apply_pr()`

```python
async def apply_pr(db: AsyncSession, pr: PullRequest, apply_user_id: uuid.UUID) -> None
```

Called by the PR approval endpoint. Executes within the caller's transaction (no separate commit).

### Execution Steps

1. **Topological sort** the operations based on temp_id dependencies (operates on a copy of `pr.payload` — the original is never mutated)
2. **Sequentially execute** each operation via the dispatch table
3. **Build enriched records** with `result_id` and `result_browse_path` for each operation
4. **Write `applied_result`** — store the enriched records on `pr.applied_result` (separate from `pr.payload`)
5. **Recursive Reindexing** —Structural changes (like directory moves) trigger recursive search index updates for all descendants.

### Payload Immutability

`pr.payload` is the original intent document as submitted by the user. It is **never mutated**. After approval, `pr.applied_result` holds the enriched copy. This separation allows:
- Re-reviewing a PR based on its original stated intent
- Distinguishing what the user asked for vs. what actually happened
- Cleaner partial-failure reasoning (no half-enriched payload to reason about)

## Topological Sort (`topo_sort_operations()`)

Uses **Kahn's algorithm** to order operations so that any operation defining a `temp_id` runs before operations referencing that `temp_id`.

### Algorithm

1. Build a `definer` map: temp_id → index of the defining operation
2. Build a dependency graph: for each operation, find all `$`-prefixed references in its fields
3. Compute in-degrees
4. Process nodes with in-degree 0, maintaining original submission order (stable sort by index)
5. Raise `BadRequestError` if a cycle is detected

### Reference Collection (`_collect_temp_refs()`)

Scans all fields of an operation dict for `$`-prefixed values:
- Top-level string fields (e.g., `directory_id: "$dir1"`)
- Nested list items (e.g., `attachments: [{ directory_id: "$dir1" }]`)
- The operation's own `temp_id` is excluded from references

### Resolution (`_resolve()`)

Resolves a value that may be:
- `None` → returns `None`
- A `$`-prefixed temp_id → looks up in the `id_map` dict, raises if not found
- A UUID string → parses and returns
- An invalid string → raises `BadRequestError`

## Operation Executors

### `_exec_create_material()`

1. Resolve tags (get_or_create pattern)
2. Resolve `directory_id` through temp_id map
3. Generate unique slug within the directory (`_unique_material_slug`)
4. Create `Material` row
5. If `file_key` provided:
   - **CAS V2:** `file_key` is already `cas/{hmac}` — no S3 copy needed. Size and MIME type come from the PR payload.
   - **Legacy V1 fallback:** If `file_key` starts with `uploads/`, copy to `materials/` prefix (backward compatibility during migration).
   - `increment_cas_ref` for the new MaterialVersion
   - Create `MaterialVersion` row with `file_key=cas/{hmac}`, `cas_sha256`, `virus_scan_result=CLEAN`
6. Process attachments (if any):
   - Create a system directory `attachments:{material_id}`
   - For each attachment: create Material + MaterialVersion + increment CAS ref
7. Schedule post-commit search indexing

### `_exec_edit_material()`

1. Resolve material_id, load material with tags
2. Update title/type/description/tags/metadata as provided
3. If title changed: regenerate slug (unique within directory)
4. If `file_key` provided: create new `MaterialVersion` with incremented `version_number`, `increment_cas_ref`
5. **Optimistic Locking**: If `version_lock` is provided in the operation, it is verified against the latest `MaterialVersion.version_lock`. A mismatch raises `ConflictError`.
6. Schedule search re-indexing

### `_exec_delete_material()`

1. Resolve and load material
2. Collect all file keys from all versions
3. Delete the material (cascade deletes versions)
4. If a system attachment directory exists: collect and delete those file keys too
5. Schedule: search index removal + CAS ref decrements via `delete_storage_objects` (post-commit, which handles `cas/` keys via ref counting)

### `_exec_create_directory()`

1. Resolve tags and parent_id
2. Generate unique slug among siblings
3. Create `Directory` row
4. Schedule search indexing

### `_exec_edit_directory()`

1. Resolve and load directory with tags
2. Update name/type/description/tags/metadata
3. Re-slug if name changed
4. Schedule search re-indexing

### `_exec_delete_directory()`

1. Resolve and load directory
2. Delete (cascade deletes children and materials)
3. Schedule search index removal

### `_exec_move_item()`

For **directories:**
1. Resolve target and new parent
2. **Self-move prevention:** Cannot move a directory into itself
3. **Circular ancestry check:** Walk up from `new_parent_id` to verify `target_id` is not an ancestor. This prevents creating circular references in the directory tree.
4. Update `parent_id`
5. **Optimistic Locking**: If the target is a material, its `version_lock` is verified if provided.
6. **Recursive Reindexing**: All items within the directory tree (sub-directories and materials) are enqueued for re-indexing in the background.

For **materials:**
1. Resolve target and new parent
2. Update `directory_id`
3. Regenerate slug for uniqueness in the new location
4. Re-index

## Slug Uniqueness

### `_unique_material_slug()`

Generates a slug unique within a directory by:
1. Base slug from `slugify(title)` (or "untitled")
2. Query all existing slugs matching `base` or `base-%` pattern **with `FOR UPDATE`** lock
3. **Post-filter** with `_slug_pattern(base)` regex (`^base(?:-\d+)?$`) to exclude slugs that merely share a prefix (e.g., `linear-algebra-notes` does not collide with `linear-algebra`)
4. If base is available: use it
5. Otherwise: append `-2`, `-3`, ... until a unique candidate is found
6. Fallback: append random hex suffix

The `FOR UPDATE` lock prevents two concurrent PR applications from generating the same slug in a race condition. The regex post-filter prevents false collisions from prefix matches.

### `_unique_directory_slug()`

Same algorithm, applied to directory siblings.

## Browse Path Resolution (`_build_browse_path()`)

After each operation executes, the engine resolves the full slug-based browse path for the result. This is stored in `applied_result` so the frontend can link directly to the created/edited items from the PR detail view.

For **delete operations**, the browse path is captured BEFORE the deletion occurs (since the item won't exist after).

## MIME Type Resolution (`_resolve_mime_type()`)

Determines the authoritative MIME type for a file:
1. If S3 metadata has a specific MIME type (not `application/octet-stream`): use it
2. Otherwise: fall back to the client-provided hint from the payload
3. Final fallback: `application/octet-stream`

## File Info Resolution (`_get_file_info()`)

Reads the actual file size and content type from S3 via `HEAD` request. This ensures the database records reflect the true file size after processing (compression may have changed it), not the client's declared size.

Only used for legacy `uploads/` paths. CAS V2 keys trust the payload-provided size and MIME type.

## Constraints and Validation

### Attachment Nesting Limit
The system enforces a strict 2-level nesting limit for materials. A material can have attachments, but an attachment cannot have its own attachments. This is validated during PR creation (`create_pull_request_service`).

### File Claiming
To prevent race conditions where two users attempt to include the same file in different contributions, the system uses `PRFileClaim` rows. A `file_key` can only be held by one **open** PR at a time. This is enforced via a unique database constraint.

### Ownership Enforcement
When submitting a PR, the system verifies that all `file_key`s either start with the user's specific upload prefix (`uploads/{user_id}/`) or already exist in the content-addressable storage (`cas/`).
