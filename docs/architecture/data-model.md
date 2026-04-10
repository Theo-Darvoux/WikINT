# Data Model & Schema

## Entity Relationship Overview

```
                    ┌─────────────┐
                    │    User     │
                    │─────────────│
                    │ id (UUID PK)│
                    │ email       │
                    │ display_name│
                    │ role (enum) │
                    │ onboarded   │
                    │ is_flagged  │
                    │ deleted_at  │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┬──────────────────┐
          │ author_id      │ author_id      │ author_id        │
          ▼                ▼                ▼                  ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  ┌────────────┐
   │ PullRequest  │ │  Material    │ │  Annotation  │  │  Comment   │
   │──────────────│ │──────────────│ │──────────────│  │────────────│
   │ type (batch) │ │ directory_id │ │ material_id  │  │ target_type│
   │ status (enum)│ │ title, slug  │ │ body         │  │ target_id  │
   │ payload JSONB│ │ type         │ │ page_number  │  │ body       │
   │ summary_types│ │ current_ver  │ │ coordinates  │  │ parent_id  │
   │ virus_scan   │ │ author_id    │ └──────────────┘  └────────────┘
   └──────┬───────┘ │ metadata JSONB│
          │         │ download_cnt │
          │         └──────┬───────┘
    ┌─────┴─────┐          │
    │           │          │ material_id
    ▼           ▼          ▼
┌─────────┐ ┌────────┐ ┌────────────────┐
│ PRVote  │ │PRComment│ │MaterialVersion │
│─────────│ │────────│ │────────────────│
│ pr_id   │ │ pr_id  │ │ material_id    │
│ user_id │ │body    │ │ version_number │
│ value   │ │parent_id│ │ file_key       │
│ (unique │ └────────┘ │ file_name      │
│  per PR)│            │ file_size      │
└─────────┘            │ file_mime_type │
                       │ virus_scan     │
                       │ pr_id          │
                       └────────────────┘
```

## Core Entities

### User
**Table:** `users`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PK, default uuid4 | |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | Login identifier |
| `display_name` | VARCHAR(100) | nullable | Shown in UI |
| `avatar_url` | VARCHAR(500) | nullable | Profile picture URL |
| `role` | ENUM(student, member, bureau, vieux) | default 'student' | Authorization level |
| `bio` | TEXT | nullable | User profile text |
| `academic_year` | VARCHAR(10) | nullable | e.g. "2024" |
| `gdpr_consent` | BOOLEAN | default false | GDPR tracking |
| `gdpr_consent_at` | TIMESTAMP(tz) | nullable | When consent was given |
| `onboarded` | BOOLEAN | default false | Whether user completed onboarding |
| `is_flagged` | BOOLEAN | default false | Moderator-flagged account |
| `created_at` | TIMESTAMP(tz) | server_default now() | |
| `last_login_at` | TIMESTAMP(tz) | nullable | |
| `deleted_at` | TIMESTAMP(tz) | nullable | Soft-delete timestamp |

**Roles hierarchy:**
- `student` - Base role. Can upload, create PRs, comment
- `moderator` - Can approve/reject PRs (moderator)
- `bureau` - Association leadership (all member perms + admin)
- `vieux` - Alumni with elevated permissions

### Directory
**Table:** `directories`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PK | |
| `parent_id` | UUID | FK(directories.id) CASCADE, nullable | Self-referential tree |
| `name` | VARCHAR(200) | NOT NULL | Display name |
| `slug` | VARCHAR(200) | NOT NULL | URL-safe identifier |
| `type` | ENUM(module, folder) | NOT NULL | Top-level vs nested |
| `description` | TEXT | nullable | |
| `metadata` | JSONB | default {} | Extensible key-value store |
| `sort_order` | INTEGER | default 0 | Manual ordering |
| `is_system` | BOOLEAN | default false | System-managed (e.g. attachment dirs) |
| `created_by` | UUID | FK(users.id) SET NULL | |
| `created_at` | TIMESTAMP(tz) | | |
| `updated_at` | TIMESTAMP(tz) | | |

**Unique constraint:** `(parent_id, slug)` - Slugs must be unique among siblings.

**System directories:** When a material has attachments, a system directory named `attachments:{material_id}` is automatically created with `is_system=true`. These are invisible in the browse UI but hold child materials.

### Material
**Table:** `materials`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PK | |
| `directory_id` | UUID | FK(directories.id) CASCADE, nullable | Parent directory (nullable for root-level) |
| `title` | VARCHAR(300) | NOT NULL | |
| `slug` | VARCHAR(300) | NOT NULL | URL segment |
| `description` | TEXT | nullable | |
| `type` | VARCHAR(50) | NOT NULL | Content category (pdf, image, video, etc.) |
| `current_version` | INTEGER | default 1 | Denormalized latest version number |
| `parent_material_id` | UUID | FK(materials.id) CASCADE | For attachment hierarchies |
| `author_id` | UUID | FK(users.id) SET NULL | |
| `metadata` | JSONB | default {} | Extensible properties |
| `download_count` | INTEGER | default 0 | |
| `created_at` | TIMESTAMP(tz) | | |
| `updated_at` | TIMESTAMP(tz) | | |

**Unique constraints:**
- `(directory_id, slug)` for materials within a directory
- Partial unique index on `slug` WHERE `directory_id IS NULL` (root-level uniqueness)

### MaterialVersion
**Table:** `material_versions`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PK | |
| `material_id` | UUID | FK(materials.id) CASCADE, NOT NULL | |
| `version_number` | INTEGER | NOT NULL | Monotonically increasing per material |
| `file_key` | VARCHAR(500) | nullable | S3 object key |
| `file_name` | VARCHAR(300) | nullable | Original filename |
| `file_size` | BIGINT | nullable | Bytes |
| `file_mime_type` | VARCHAR(100) | nullable | |
| `diff_summary` | TEXT | nullable | Human-readable change description |
| `author_id` | UUID | FK(users.id) SET NULL | Who uploaded this version |
| `pr_id` | UUID | FK(pull_requests.id) SET NULL | Which PR introduced this version |
| `virus_scan_result` | VARCHAR(20) | default 'pending' | One of: pending, clean, malicious |
| `version_lock` | INTEGER | default 0 | Optimistic concurrency counter — incremented on each file edit |
| `created_at` | TIMESTAMP(tz) | | |

**Unique constraint:** `(material_id, version_number)` - No duplicate version numbers.

**Optimistic locking:** PR operations that edit a material's file may include `version_lock` in the operation payload. At apply time, the server verifies the current `version_lock` on the latest `MaterialVersion` matches. A mismatch (concurrent edit since PR submission) raises a `ConflictError` and the PR is not applied.

### PullRequest
**Table:** `pull_requests`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PK | |
| `status` | ENUM(open, approved, rejected) | default 'open' | |
| `title` | VARCHAR(300) | NOT NULL | |
| `description` | TEXT | nullable | |
| `rejection_reason` | TEXT | nullable | Fixed in Audit v3 |
| `payload` | JSONB | NOT NULL | Array of operation objects |
| `applied_result` | JSONB | nullable | Enriched result (IDs/paths) |
| `author_id` | UUID | FK(users.id) SET NULL | |
| `reviewed_by` | UUID | FK(users.id) SET NULL | |
| `created_at` | TIMESTAMP(tz) | | |

---

### PRFileClaim
**Table:** `pr_file_claims`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `file_key` | VARCHAR(500) | PK | Atomic lock for temp files |
| `pr_id` | UUID | FK(pull_requests.id) CASCADE | |

**Constraint:** `PRIMARY KEY (file_key)` - Every file can be claimed by exactly one PR.

---

### CAS (Content-Addressable Storage)
**Table:** `cas_entries`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `sha256` | VARCHAR(64) | PK | File content hash |
| `file_key` | VARCHAR(500) | NOT NULL | S3 storage key |
| `mime_type` | VARCHAR(100) | | |
| `size_bytes` | BIGINT | | |
| `ref_count` | INTEGER | default 1 | Reference count for GC |
| `scanned_at` | TIMESTAMP(tz) | | For YARA staleness checks |

**PRVote** (`pr_votes`): One vote per user per PR. `value` is a SmallInteger (typically +1 / -1).

**PRComment** (`pr_comments`): Threaded comments on PRs. Self-referential `parent_id` for nested replies.

**Comment** (`comments`): Generic polymorphic comments via `target_type` + `target_id` fields.

**Annotation** (`annotations`): Document annotations with `page_number`, `coordinates` (JSONB), and a text `body`.

**Tag** (`tags`): Tags with `name` and optional `category`. Many-to-many with both materials and directories via `material_tags` and `directory_tags` junction tables.

**Flag** (`flags`): Content moderation flags with `target_type`, `target_id`, `reason`, and `status`.

**Notification** (`notifications`): User notifications with `type`, `title`, `message`, and `data` (JSONB). Linked to user via `user_id`.

**ViewHistory** (`view_history`): Tracks which users viewed which materials.

**DownloadAudit** (`download_audits`): Audit log of file downloads.

**Upload** (`uploads`): Lifecycle tracking for the upload pipeline. Stores `upload_id`, `quarantine_key`, `status`, `sha256`, `content_sha256`, `final_key`, `pipeline_stage`, `cas_key`, `cas_ref_count`, and `error_detail`. The `cas_key` and `cas_ref_count` columns are dual-written alongside the Redis CAS entry when a file is first promoted to `cas/` (Phase 5, item 3.5). DB row creation is mandatory — the upload request fails if the row cannot be persisted.

## VirusScanResult Enum

Used on both `MaterialVersion` and `PullRequest`:

```python
class VirusScanResult(str, Enum):
    PENDING = "pending"
    CLEAN = "clean"
    MALICIOUS = "malicious"
```

## Base Mixins

All models inherit from `Base` (SQLAlchemy declarative base). Two mixins provide common columns:

- **`UUIDMixin`**: Adds `id: UUID` primary key with `uuid4` default
- **`TimestampMixin`**: Adds `created_at` and `updated_at` with auto-population

## Migration History

Migrations use Alembic with the async SQLAlchemy engine. Key migrations in order:

1. `001_initial` - Full initial schema (users, directories, materials, versions, PRs, votes, comments, tags, etc.)
2. `002_batch_pr_upgrade` - Upgraded PR payload from single-op to batch array format
3. `b4c8deec8f6b_add_virus_scan_result` - Added virus_scan_result columns to materials and PRs
4. `30def97c09a1_migrate_pending_scans_to_clean` - Data migration: set existing PENDING scans to CLEAN
5. `016ff5f329ae_fix_summary_types_containing_null` - Clean up null values in JSONB arrays
6. `138afbd354d9_add_download_audit_and_user_flagging` - Added download audit table and is_flagged to users
7. `2447499a3966_make_material_directory_id_nullable` - Allow root-level materials (no directory)
8. `a1b2c3d4e5f6_add_uploads_table` - Added the uploads lifecycle tracking table
