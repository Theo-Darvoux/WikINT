# Pydantic Schemas (`api/app/schemas/`)

## Purpose

Pydantic v2 models used for request validation and response serialization. They define the API contract between frontend and backend.

## Schema Files

### `auth.py`
- `RequestCodeIn` — `{ email: str }`
- `VerifyCodeIn` — `{ email: str, code: str }`
- `VerifyMagicLinkIn` — `{ token: str }`
- `UserBrief` — Subset of user fields returned after authentication: id, email, display_name, avatar_url, role, onboarded
- `TokenResponse` — `{ access_token, user: UserBrief, is_new_user }`
- `RefreshResponse` — `{ access_token }`

### `material.py`
Upload-related schemas dominate this file:

**Upload Flow:**
- `UploadInitRequest` — `{ filename, size, mime_type }` — Client declares intent
- `PresignedUploadOut` — `{ upload_url, file_key, upload_id }` — Presigned PUT URL
- `UploadCompleteRequest` — `{ file_key, checksum? }` — Client signals upload done
- `UploadPendingOut` — `{ upload_id, file_key, status: "pending" }` — Accepted for processing
- `UploadStatusOut` — `{ upload_id, file_key, status, detail?, result?, stage_index?, overall_percent? }`
- `UploadStatus` — Enum: pending, processing, clean, malicious, failed

**Presigned Multipart:**
- `PresignedMultipartInitOut` — `{ file_key, upload_id, s3_upload_id, parts: [{ part_number, url }] }`
- `PresignedMultipartPart` — `{ part_number, url }`
- `PresignedMultipartCompleteRequest` — `{ file_key, s3_upload_id, parts: [{ PartNumber, ETag }] }`

**CAS Deduplication:**
- `CheckExistsRequest` — `{ sha256 }`
- `CheckExistsOut` — `{ exists, file_key?, ... }`

### `pull_request.py`
- `PullRequestCreate` — `{ title, description?, operations: list[Operation] }` — Discriminated union of 7 op types
- `PullRequestOut` — Full PR response with:
  - `payload`, `applied_result` (enriched ops with `result_id`, `result_browse_path`, `pre_state`)
  - `approved_at` — Timestamp anchoring the 7-day revert grace window
  - `reverts_pr_id` / `reverted_by_pr_id` — Revert linkage (self-FKs)
  - `revert_grace_expires_at` — Computed: `approved_at + 7d`
  - `can_revert` — Computed boolean (approved + not revert type + within grace + has pre_state)
- `RejectRequest` — `{ reason: str }` (min 10, max 1000 chars)
- Operation schemas: `CreateMaterialOp`, `EditMaterialOp`, `DeleteMaterialOp`, `CreateDirectoryOp`, `EditDirectoryOp`, `DeleteDirectoryOp`, `MoveItemOp`

### `common.py`
- `HealthResponse` — `{ status: "ok" }`
- Pagination schemas (offset/limit)

### `home.py`
Response schemas for the Home page aggregate endpoint:

- `FeaturedItemOut` — A curated featured item with its fully resolved material:
  - `id` — UUID of the `FeaturedItem` row
  - `material: MaterialDetail` — Full material detail (including `current_version_info`)
  - `title`, `description` — Optional override copy (moderator-supplied)
  - `start_at`, `end_at` — Active window datetimes
  - `priority` — Integer sort weight

- `HomeResponse` — Top-level response for `GET /api/home/`:
  - `featured: list[FeaturedItemOut]` — Active featured items, priority DESC
  - `popular_today: list[MaterialDetail]` — Top 8 root materials by `views_today` DESC
  - `popular_14d: list[MaterialDetail]` — Top 8 root materials by `views_14d` DESC
  - `recent_prs: list[PullRequestOut]` — 5 most recently opened open PRs
  - `recent_favourites: list[MaterialDetail]` — User's 6 most recently favourited materials

### `featured.py`
Request schemas for the admin featured-item management endpoints:

- `FeaturedItemCreate` — Body for `POST /api/admin/featured`:
  - `material_id: uuid.UUID` — Which material to feature
  - `title`, `description` — Optional override copy
  - `start_at`, `end_at` — Required active window (must satisfy `end_at > start_at`)
  - `priority: int` — Default 0

- `FeaturedItemUpdate` — Body for `PATCH /api/admin/featured/{id}` (all fields optional):
  - `title`, `description`, `start_at`, `end_at`, `priority`

## Validation Patterns

Schemas use Pydantic v2 with `model_config` for configuration. Key patterns:
- `from_attributes = True` on response models for ORM compatibility
- Field aliases where Python naming conflicts with DB columns
- Optional fields with sensible defaults
- String length constraints matching database column limits

## Input Sanitization (`app/core/sanitization.py`)

All user-supplied text fields use `SanitizedStr` (or constrained subtypes) which applies
`clean_text()` as a `BeforeValidator`. This strips:

- C0 control characters (`\x00`–`\x1f`) **except** tab, LF, CR (which have legitimate use in text)
- DEL (`\x7f`) and C1 controls (`\x80`–`\x9f`)
- Zero-width / invisible Unicode formatting chars (`U+200B`–`U+200F`)
- BIDI override / isolate chars (`U+202A`–`U+202E`) — used in homograph/spoofing attacks
- Deprecated formatting chars (`U+206A`–`U+206F`), BOM (`U+FEFF`), interlinear anchors

### Per-field limits

| Field | Schema | Min | Max |
|---|---|---|---|
| `display_name` | `OnboardIn`, `UserUpdateIn` | 1 | 64 |
| `bio` | `UserUpdateIn` | — | 500 |
| `avatar_url` | `UserUpdateIn` | — | 2048 (must be https:// or cas/materials/ key) |
| `academic_year` | `OnboardIn`, `UserUpdateIn` | — | allowlist: 1A, 2A, 3A+ |
| PR `title` | `PullRequestCreate` | 3 | 300 |
| PR `description` | `PullRequestCreate` | — | 1000 |
| `RejectRequest.reason` | `RejectRequest` | 10 | 1000 |
| Comment / PR comment `body` | `CommentCreateIn`, `PRCommentCreate` | 1 | 10 000 |
| Annotation `body` | `AnnotationCreateIn` | 1 | 1 000 |
| `selection_text` | `AnnotationCreateIn` | — | 1 000 |
| `reply_to_id` | `AnnotationCreateIn` | — | 36 (must be valid UUID) |
| `position_data` | `AnnotationCreateIn` | — | 20 keys |
| `page` | `AnnotationCreateIn` | 0 | 100 000 |
| Flag `description` | `FlagCreateIn` | — | 1 000 |
| Material / directory `title` / `name` | PR ops | 1 | 100 |
| Material / directory `description` | PR ops | — | 1 000 |
| Tags | PR ops | — | 20 tags × 20 chars each |
| Metadata | PR ops | — | 20 keys |
| `target_name`, `target_title` | `MoveItemOp` | — | 100 |
| `filename` | `UploadInitRequest` | 1 | 255 |
| `size` | `UploadInitRequest`, `CheckExistsRequest` | 0 | — |
| `mime_type` | `UploadInitRequest` | — | 200 |
| `sha256` | `UploadInitRequest`, `CheckExistsRequest` | 64 | 64 (hex only) |
| `file_keys` items | `BatchStatusRequest` | — | 512 per key, no `..` |
| OTP `code` | `VerifyCodeIn` | 8 | 8 (pattern: `[A-Z2-9]{8}`) |
| Magic `token` | `VerifyMagicLinkIn` | 1 | 128 |
| Search `query` | router query param | 1 | 200 |
| Search `type` | router query param | — | allowlist of material types + "directory" |

### Allowlists

- **Material types**: `polycopie`, `annal`, `cheatsheet`, `tip`, `review`, `discussion`, `video`, `document`, `other`
- **Directory types**: `folder`, `course`, `year`, `semester`, `other`
- **Search type filter**: material types + `directory`
- **Flag reasons**: `inappropriate`, `copyright`, `spam`, `incorrect`, `other`
- **Flag target types**: `material`, `annotation`, `pull_request`, `comment`, `pr_comment`

### File-key / filename path-traversal prevention

- `file_key` must start with `uploads/` or `cas/` — no `..` or null bytes
- `file_name` must not contain `/`, `\`, or null bytes
- `BatchStatusRequest.file_keys` items reject `..` and null bytes
