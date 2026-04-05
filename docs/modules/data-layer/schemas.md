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
- `PRResponse` — Full PR with author, votes, comments
- `PRListItem` — Abbreviated PR for list views

### `common.py`
- `HealthResponse` — `{ status: "ok" }`
- Pagination schemas (offset/limit)

## Validation Patterns

Schemas use Pydantic v2 with `model_config` for configuration. Key patterns:
- `from_attributes = True` on response models for ORM compatibility
- Field aliases where Python naming conflicts with DB columns
- Optional fields with sensible defaults
- String length constraints matching database column limits
