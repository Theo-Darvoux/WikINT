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
- `PRCreateRequest` — `{ title, description?, payload: list[dict] }` — The payload is validated loosely (JSONB array of operation objects)
- `PRResponse` — Full PR with author, comments
- `PRListItem` — Abbreviated PR for list views

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
